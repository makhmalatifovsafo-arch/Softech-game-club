using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;

namespace ClientSetup
{
    public partial class MainWindow : Window
    {
        private string installedDirectory = @"C:\SoftechClient";

        public MainWindow()
        {
            InitializeComponent();
        }

        private void BtnBrowse_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new OpenFolderDialog
            {
                Title = "Softech Client o'rnatiladigan katalogni tanlang",
                InitialDirectory = @"C:\"
            };

            if (dialog.ShowDialog() == true)
            {
                TxtInstallPath.Text = Path.Combine(dialog.FolderName, "SoftechClient");
            }
        }

        private async void BtnInstall_Click(object sender, RoutedEventArgs e)
        {
            string targetDir = TxtInstallPath.Text.Trim();
            string serverUrl = TxtServerUrl.Text.Trim();
            string wsName = TxtWorkstationName.Text.Trim();

            if (string.IsNullOrWhiteSpace(targetDir) || string.IsNullOrWhiteSpace(serverUrl) || string.IsNullOrWhiteSpace(wsName))
            {
                MessageBox.Show("Iltimos, barcha maydonlarni to'ldiring.", "Ogohlantirish", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            // Extract number from name if possible (e.g. PC-01 -> 1)
            int pcNumber = 1;
            var match = Regex.Match(wsName, @"\d+");
            if (match.Success && int.TryParse(match.Value, out int parsedNum))
            {
                pcNumber = parsedNum;
            }

            installedDirectory = targetDir;
            BtnInstall.IsEnabled = false;
            BtnBrowse.IsEnabled = false;
            PbProgress.Visibility = Visibility.Visible;
            PbProgress.IsIndeterminate = true;
            TxtStatus.Text = "Client fayllari ajratilmoqda va sozlanmoqda...";

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

                    // Agar eski NetCafeClient ishlab turgan bo'lsa, xavfsiz to'xtatamiz
                    foreach (var proc in Process.GetProcessesByName("NetCafeClient"))
                    {
                        try
                        {
                            proc.Kill();
                            proc.WaitForExit(3000);
                        }
                        catch { }
                    }

                    // Extract embedded payload.zip
                    var assembly = Assembly.GetExecutingAssembly();
                    using (Stream? resourceStream = assembly.GetManifestResourceStream("payload.zip"))
                    {
                        if (resourceStream == null)
                        {
                            throw new Exception("O'rnatuvchi ichidan 'payload.zip' resursi topilmadi!");
                        }

                        string tempZipPath = Path.Combine(Path.GetTempPath(), $"softech_client_{Guid.NewGuid():N}.zip");
                        try
                        {
                            using (var fileStream = new FileStream(tempZipPath, FileMode.Create, FileAccess.Write))
                            {
                                resourceStream.CopyTo(fileStream);
                            }

                            ZipFile.ExtractToDirectory(tempZipPath, targetDir, overwriteFiles: true);
                        }
                        finally
                        {
                            if (File.Exists(tempZipPath))
                            {
                                try { File.Delete(tempZipPath); } catch { }
                            }
                        }
                    }

                    // Write config.json
                    string configPath = Path.Combine(targetDir, "config.json");
                    var configObj = new
                    {
                        serverUrl = serverUrl,
                        pcNumber = wsName,
                        workstationName = wsName,
                        heartbeatIntervalSeconds = 5
                    };
                    string json = JsonSerializer.Serialize(configObj, new JsonSerializerOptions { WriteIndented = true });
                    File.WriteAllText(configPath, json);

                    // Shortcuts
                    string exePath = Path.Combine(targetDir, "NetCafeClient.exe");

                    if (createDesktopShortcut)
                    {
                        string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                        CreateShortcut(
                            shortcutPath: Path.Combine(desktopPath, "Softech Client Kiosk.lnk"),
                            targetPath: exePath,
                            workingDir: targetDir,
                            description: "Softech Game Club Client Kiosk");
                    }

                    if (enableAutoStart)
                    {
                        string startupPath = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                        CreateShortcut(
                            shortcutPath: Path.Combine(startupPath, "SoftechClientKiosk.lnk"),
                            targetPath: exePath,
                            workingDir: targetDir,
                            description: "Softech Client Auto Lock on Startup");
                    }
                });

                PbProgress.IsIndeterminate = false;
                PbProgress.Value = 100;
                TxtStatus.Text = $"✅ {wsName} muvaffaqiyatli o'rnatildi va {serverUrl} manziliga sozlandi!";
                TxtStatus.Foreground = System.Windows.Media.Brushes.LightGreen;

                BtnStartClient.Visibility = Visibility.Visible;
                BtnInstall.Content = "Qayta Sozlash";
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

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            try
            {
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
                        shortcut.Save();
                    }
                }
            }
            catch { }
        }

        private void BtnStartClient_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                string exePath = Path.Combine(installedDirectory, "NetCafeClient.exe");
                if (File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = installedDirectory,
                        UseShellExecute = true
                    });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Client dasturini ishga tushirib bo'lmadi: {ex.Message}", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}