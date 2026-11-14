using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;

namespace ServerSetup
{
    public partial class MainWindow : Window
    {
        private readonly string? previousInstall;

        public MainWindow()
        {
            InitializeComponent();
            string candidate = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Softech\Server", "InstallPath", @"C:\SoftechServer") as string ?? @"C:\SoftechServer";
            if (File.Exists(Path.Combine(candidate, "netcafe.db")))
            {
                previousInstall = Path.GetFullPath(candidate);
                TxtInstallPath.Text = previousInstall;
            }
        }

        private void BtnBrowse_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new OpenFolderDialog
            {
                Title = "Softech Server o'rnatiladigan katalogni tanlang",
                InitialDirectory = @"C:\"
            };

            if (dialog.ShowDialog() == true)
            {
                TxtInstallPath.Text = Path.Combine(dialog.FolderName, "SoftechServer");
            }
        }

        private async void BtnInstall_Click(object sender, RoutedEventArgs e)
        {
            string targetDir = TxtInstallPath.Text.Trim();
            if (string.IsNullOrWhiteSpace(targetDir))
            {
                MessageBox.Show("Iltimos, o'rnatish katalogini ko'rsating.", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (previousInstall != null && !Path.GetFullPath(targetDir).TrimEnd(Path.DirectorySeparatorChar).Equals(
                previousInstall.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show("Mavjud baza " + previousInstall + " papkasida. Ma’lumotlar bilan davom etish uchun shu papkaga qayta o‘rnating.", "Mavjud bazani saqlash", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            BtnInstall.IsEnabled = false;
            BtnBrowse.IsEnabled = false;
            PbProgress.Visibility = Visibility.Visible;
            PbProgress.IsIndeterminate = true;
            TxtStatus.Text = "Fayllar ajratilmoqda va tizim tayyorlanmoqda...";

            bool createDesktopShortcut = ChkDesktopShortcut.IsChecked == true;
            bool enableAutoStart = ChkAutoStart.IsChecked == true;

            try
            {
                await Task.Run(() =>
                {
                    if (!Directory.Exists(targetDir))
                    {
                        Directory.CreateDirectory(targetDir);
                    }

                    ServiceInstallation.EnsureEmergencySessionsClosed();
                    Softech.Updates.ServerService.StopAndWait(targetDir);
                    // Close only this installation's legacy launcher before its backend.
                    foreach(var cockpit in Process.GetProcessesByName("SoftechCockpit"))using(cockpit) {
                        if(string.Equals(cockpit.MainModule?.FileName,Path.Combine(Path.GetFullPath(targetDir),"SoftechCockpit.exe"),StringComparison.OrdinalIgnoreCase)) {
                            cockpit.Kill(true);if(!cockpit.WaitForExit(10000))throw new IOException("Kassa oynasi yopilmadi. O'rnatish to'xtatildi.");
                        }
                    }
                    // 1. Agar server (node.exe) ishlab turgan bo'lsa, xavfsiz to'xtatamiz
                    foreach (var proc in Process.GetProcessesByName("node"))
                    {
                        try
                        {
                            string? procPath = proc.MainModule?.FileName;
                            if (procPath != null && procPath.StartsWith(Path.GetFullPath(targetDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            {
                                proc.Kill();
                                if(!proc.WaitForExit(10000))throw new IOException("Eski server to'xtamadi.");
                            }
                        }
                        catch (System.ComponentModel.Win32Exception) { /* Unrelated protected Windows processes. */ }
                    }

                    if(!Softech.Updates.UpdateJournal.Recover(targetDir))throw new IOException("Yangilovchi hali ishlamoqda. Setup fayllarni almashtirmadi.");
                    string maintenanceFile=Softech.Updates.PackageManifest.ChildPath(targetDir,".ota/update.lock");
                    Directory.CreateDirectory(Path.GetDirectoryName(maintenanceFile)!);
                    using var maintenance=new FileStream(maintenanceFile,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
                    using var backendGuard=Softech.Updates.UpdateJournal.AcquireServerLock(targetDir);
                    DatabaseSafety.Backup(targetDir);

                    // Extract embedded payload.zip
                    var assembly = Assembly.GetExecutingAssembly();
                    using (Stream? resourceStream = assembly.GetManifestResourceStream("payload.zip"))
                    {
                        if (resourceStream == null)
                        {
                            throw new Exception("O'rnatuvchi ichidan 'payload.zip' resursi topilmadi!");
                        }

                        string tempZipPath = Path.Combine(Path.GetTempPath(), $"softech_server_{Guid.NewGuid():N}.zip");
                        try
                        {
                            using (var fileStream = new FileStream(tempZipPath, FileMode.Create, FileAccess.Write))
                            {
                                resourceStream.CopyTo(fileStream);
                            }

                            Softech.Updates.SafePackageExtraction.Extract(tempZipPath, targetDir);
                            // SafePackageExtraction preserves existing configuration.
                            // Do not truncate and rewrite a club's settings during repair.
                            string configFile = Path.Combine(targetDir, "config.json");
                            if (!File.Exists(configFile))
                            {
                                string temporaryConfig = configFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
                                try
                                {
                                    using (var stream = new FileStream(temporaryConfig, FileMode.CreateNew, FileAccess.Write))
                                    {
                                        stream.Write(System.Text.Encoding.UTF8.GetBytes("{\"updateIdleSeconds\":10}"));
                                        stream.Flush(flushToDisk: true);
                                    }
                                    File.Move(temporaryConfig, configFile, overwrite: false);
                                }
                                finally { if (File.Exists(temporaryConfig)) File.Delete(temporaryConfig); }
                            }
                        }
                        finally
                        {
                            if (File.Exists(tempZipPath))
                            {
                                try { File.Delete(tempZipPath); } catch { }
                            }
                        }
                    }

                    // Shortcuts creation
                    string cockpitPath = Path.Combine(targetDir, "SoftechCockpit.exe");
                    string batPath = Path.Combine(targetDir, "start_server.bat");
                    string vbsPath = Path.Combine(targetDir, "start_server_background.vbs");
                    string iconPath = Path.Combine(targetDir, "app.ico");

                    string primaryExe = File.Exists(cockpitPath) ? cockpitPath : batPath;

                    if (createDesktopShortcut)
                    {
                        string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                        CreateShortcut(
                            shortcutPath: Path.Combine(desktopPath, "Softech NetCafe Server.lnk"),
                            targetPath: primaryExe,
                            workingDir: targetDir,
                            description: "Softech Game Club — Standalone Server Cockpit",
                            iconPath: File.Exists(iconPath) ? iconPath : null);
                    }

                    string startupPath = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                    string oldShortcut=Path.Combine(startupPath,"SoftechServerBackground.lnk");
                    if(File.Exists(oldShortcut))File.Delete(oldShortcut);
                    if (enableAutoStart)
                    {
                        CreateShortcut(
                            shortcutPath: Path.Combine(startupPath, "SoftechServerBackground.lnk"),
                            targetPath: primaryExe,
                            workingDir: targetDir,
                            description: "Softech Server Background Service",
                            iconPath: File.Exists(iconPath) ? iconPath : null);
                    }
                    ServiceInstallation.Install(targetDir);
                });

                PbProgress.IsIndeterminate = false;
                Registry.SetValue(@"HKEY_CURRENT_USER\Software\Softech\Server", "InstallPath", Path.GetFullPath(targetDir));
                PbProgress.Value = 100;
                TxtStatus.Text = "✅ Server muvaffaqiyatli o'rnatildi. Oynani yopishingiz mumkin.";
                TxtStatus.Foreground = System.Windows.Media.Brushes.LightGreen;
                BtnInstall.Visibility = Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                PbProgress.Visibility = Visibility.Collapsed;
                TxtStatus.Text = $"❌ O'rnatishda xatolik: {ex.Message}";
                TxtStatus.Foreground = System.Windows.Media.Brushes.Tomato;
                MessageBox.Show($"O'rnatishda xatolik yuz berdi:\n{ex.Message}", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                BtnInstall.IsEnabled = true;
                BtnBrowse.IsEnabled = true;
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description, string? iconPath = null)
        {
            try
            {
                // Using WScript.Shell via COM
                Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic? shell = Activator.CreateInstance(shellType);
                    if (shell != null)
                    {
                        dynamic shortcut = shell.CreateShortcut(shortcutPath);
                        shortcut.TargetPath = targetPath;
                        shortcut.WorkingDirectory = workingDir;
                        shortcut.Description = description;
                        if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
                        {
                            shortcut.IconLocation = iconPath + ",0";
                        }
                        shortcut.Save();
                        return;
                    }
                }
            }
            catch
            {
                // Fallback to simple batch or ignore if COM fails
            }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
