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
        private string installedDirectory = @"C:\SoftechServer";

        public MainWindow()
        {
            InitializeComponent();
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

            installedDirectory = targetDir;
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

                    // 1. Agar server (node.exe) ishlab turgan bo'lsa, xavfsiz to'xtatamiz
                    foreach (var proc in Process.GetProcessesByName("node"))
                    {
                        try
                        {
                            string? procPath = proc.MainModule?.FileName;
                            if (procPath != null && procPath.StartsWith(targetDir, StringComparison.OrdinalIgnoreCase))
                            {
                                proc.Kill();
                                proc.WaitForExit(3000);
                            }
                        }
                        catch { }
                    }

                    // 2. Agar mavjud netcafe.db bo'lsa, uni zaxiralab olamiz (qayta o'rnatishda foydalanuvchi bazasi yo'qolmasligi uchun)
                    string existingDbPath = Path.Combine(targetDir, "netcafe.db");
                    string? tempDbBackup = null;
                    if (File.Exists(existingDbPath))
                    {
                        tempDbBackup = Path.Combine(Path.GetTempPath(), $"softech_db_backup_{Guid.NewGuid():N}.db");
                        try { File.Copy(existingDbPath, tempDbBackup, overwrite: true); } catch { tempDbBackup = null; }
                    }

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

                            ZipFile.ExtractToDirectory(tempZipPath, targetDir, overwriteFiles: true);

                            // Agar avvalgi baza bo'lsa, uni tiklaymiz
                            if (tempDbBackup != null && File.Exists(tempDbBackup))
                            {
                                File.Copy(tempDbBackup, existingDbPath, overwrite: true);
                            }
                        }
                        finally
                        {
                            if (File.Exists(tempZipPath))
                            {
                                try { File.Delete(tempZipPath); } catch { }
                            }
                            if (tempDbBackup != null && File.Exists(tempDbBackup))
                            {
                                try { File.Delete(tempDbBackup); } catch { }
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

                    if (enableAutoStart)
                    {
                        string startupPath = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                        CreateShortcut(
                            shortcutPath: Path.Combine(startupPath, "SoftechServerBackground.lnk"),
                            targetPath: File.Exists(vbsPath) ? vbsPath : primaryExe,
                            workingDir: targetDir,
                            description: "Softech Server Background Service",
                            iconPath: File.Exists(iconPath) ? iconPath : null);
                    }
                });

                PbProgress.IsIndeterminate = false;
                PbProgress.Value = 100;
                TxtStatus.Text = "✅ Server muvaffaqiyatli o'rnatildi! Dasturni ishga tushirishingiz mumkin.";
                TxtStatus.Foreground = System.Windows.Media.Brushes.LightGreen;

                BtnStartServer.Visibility = Visibility.Visible;
                BtnOpenBrowser.Visibility = Visibility.Visible;
                BtnInstall.Content = "Qayta O'rnatish";
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

        private void BtnStartServer_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                string cockpitPath = Path.Combine(installedDirectory, "SoftechCockpit.exe");
                if (File.Exists(cockpitPath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = cockpitPath,
                        WorkingDirectory = installedDirectory,
                        UseShellExecute = true
                    });
                    return;
                }

                string batPath = Path.Combine(installedDirectory, "start_server.bat");
                if (File.Exists(batPath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = batPath,
                        WorkingDirectory = installedDirectory,
                        UseShellExecute = true
                    });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Serverni ishga tushirib bo'lmadi: {ex.Message}", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnOpenBrowser_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "http://localhost:5000",
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Brauzerni ochib bo'lmadi: {ex.Message}", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}