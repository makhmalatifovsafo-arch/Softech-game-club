using System;
using System.Threading;
using System.Windows;
using NetCafeClient.Services;
using NetCafeClient.Services.Security;
using NetCafeClient.Views;
using WpfApplication = System.Windows.Application;

namespace NetCafeClient;

/// <summary>
/// App.xaml.cs — "Temir Qulf" Asosiy Kirish Nuqtasi.
/// Single-instance mutex, barcha servislarni ulash, lifecycle va admin rejimlarini boshqarish.
/// </summary>
public partial class App : WpfApplication
{
    // ---- Singleton va Dev Mode ----
    public static App? Instance => Current as App;
    public static bool IsDevMode { get; private set; } = false;

    // ---- Single-instance Mutex ----
    private static Mutex? _instanceMutex;

    // ---- Windows ----
    private LockWindow?               _lockWindow;
    private TimeWidgetWindow?         _timeWidget;
    private ShellWindow?              _shellWindow;
    private MaintenanceToolbarWindow? _maintenanceToolbar;

    // ---- Services ----
    private WebSocketClientService? _wsService;
    private DisplayLockManager?     _displayMgr;
    private bool                    _isSessionActive = false;

    public WebSocketClientService?   WsService          => _wsService;
    public MaintenanceToolbarWindow? MaintenanceToolbar => _maintenanceToolbar;

    // -----------------------------------------------------------------------
    // OnStartup
    // -----------------------------------------------------------------------
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        string[] args = e.Args;

        // ---- 0. Dev Mode Tekshiruvi ----
        foreach (string arg in args)
        {
            if (arg.Equals("--dev", StringComparison.OrdinalIgnoreCase) ||
                arg.Equals("--windowed", StringComparison.OrdinalIgnoreCase) ||
                arg.Equals("-dev", StringComparison.OrdinalIgnoreCase))
            {
                IsDevMode = true;
                break;
            }
        }

        // Dastur qanday yopilishidan qat'i nazar (Ctrl+C yoki taskkill) Taskbarni tiklash kafolati
        AppDomain.CurrentDomain.ProcessExit += (s, ev) =>
        {
            LockWindow.ShowWindowsTaskbar();
            TaskManagerBlocker.DisableRestrictions();
            try { UsbGuardService.Instance.RestoreRegistryPolicies(); } catch { }
        };

        // Boshlanishida taskbarni har doim ko'rsatish
        LockWindow.ShowWindowsTaskbar();

        // ---- 1. Single-instance tekshiruvi ----
        bool isNew;
        _instanceMutex = new Mutex(initiallyOwned: true, "NetCafeClient_TekirQulf_Mutex", out isNew);

        if (!isNew && !IsDevMode)
        {
            // Boshqa nusxa allaqachon ishlayapti
            System.Windows.MessageBox.Show("NetCafeClient allaqachon ishlamoqda.", "Xabar", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // ---- 2. Watchdog — faqat Production nusxa uchun ----
        bool isWatchdogInstance = false;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--watchdog-parent="))
            {
                isWatchdogInstance = true;
                break;
            }
        }

        if (isWatchdogInstance)
        {
            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();

            WatchdogService.Initialize(args);
            return;
        }

        if (!IsDevMode)
        {
            WatchdogService.Initialize(args);
        }

        // ---- 3. Oynalar yaratish ----
        _lockWindow = new LockWindow();
        _timeWidget = new TimeWidgetWindow();
        _shellWindow = new ShellWindow();
        _maintenanceToolbar = new MaintenanceToolbarWindow();

        // MaintenanceToolbar hodisalariga ulanish
        _maintenanceToolbar.OnRelockRequested += () => Dispatcher.Invoke(LockScreen);
        _maintenanceToolbar.OnSettingsRequested += () => Dispatcher.Invoke(() => _lockWindow?.OpenAdminMaintenanceModal());
        _maintenanceToolbar.OnExitRequested += () => Dispatcher.Invoke(AdminGracefulExit);

        // ---- 4. KeyboardHook ga LockWindow ni bildirish ----
        KeyboardHook.LockWindowRef = new WeakReference<LockWindow>(_lockWindow);

        // ---- 5. DisplayLockManager ----
        _displayMgr = new DisplayLockManager(_lockWindow);

        // ---- 5b. Hardware Lockdown: USB Guard & Process Guard ----
        if (!IsDevMode)
        {
            UsbGuardService.Instance.Initialize(_lockWindow);
            ProcessGuardService.Instance.Start();
        }

        // ---- 6. Dastur ochilishi bilanoq ekranni qulflash ----
        LockScreen();

        // ---- 7. WebSocket xizmatini initsializatsiya qilish ----
        _wsService = new WebSocketClientService();
        _lockWindow.SetPcNumber(_wsService.PcNumber);
        _maintenanceToolbar.SetPcInfo(_wsService.PcNumber);

        // ---- 8. LockWindow login va QR hodisalari ----
        _lockWindow.OnLoginRequested += (username, password) =>
        {
            _ = _wsService.SendMemberLoginAsync(username, password);
        };

        _lockWindow.OnQrRefreshRequested += () =>
        {
            _ = _wsService.SendQrRefreshRequestAsync();
        };

        // ---- 9. TimeWidget va ShellWindow logout hodisalari ----
        _timeWidget.OnLogoutRequested += () =>
        {
            _ = _wsService.SendLogoutAsync();
        };

        _shellWindow.OnLogoutRequested += () =>
        {
            _ = _wsService.SendLogoutAsync();
        };

        _shellWindow.OnAdminCallRequested += pc =>
        {
            System.Diagnostics.Debug.WriteLine($"[AdminCall] {pc} adminni chaqirdi.");
        };

        _shellWindow.OnBarOrderSubmitted += (summary, total) =>
        {
            System.Diagnostics.Debug.WriteLine($"[BarOrder] {summary} — {total} UZS");
        };

        // ---- 10. WebSocket hodisalariga ulanish ----

        _wsService.OnConnectionStatusChanged += isConnected =>
        {
            Dispatcher.Invoke(() => _lockWindow?.SetServerStatus(isConnected));
        };

        _wsService.OnPcConfigReceived += (zoneName, pricePerHour, formattedRate, qrToken) =>
        {
            Dispatcher.Invoke(() =>
            {
                _lockWindow?.SetZoneInfo(zoneName, pricePerHour, formattedRate);
                _shellWindow?.SetZoneInfo(zoneName, pricePerHour, formattedRate);
                if (!string.IsNullOrEmpty(qrToken))
                {
                    _lockWindow?.SetQrToken(qrToken);
                }
            });
        };

        _wsService.OnLockScreen += () =>
        {
            Dispatcher.Invoke(LockScreen);
        };

        _wsService.OnMemberLoginSuccess += (sessionId, balance, remainingSeconds, username) =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = true;
                _lockWindow?.ResetFields();
                UnlockScreen();
                _timeWidget?.StartMemberSession(username, balance, remainingSeconds, _wsService.PcNumber);
                _shellWindow?.StartMemberSession(username, balance, remainingSeconds, _wsService.PcNumber);
            });
        };

        _wsService.OnMemberLoginFailed += error =>
        {
            Dispatcher.Invoke(() => _lockWindow?.ShowError(error));
        };

        _wsService.OnBalanceUpdate += balance =>
        {
            Dispatcher.Invoke(() =>
            {
                _timeWidget?.UpdateBalance(balance);
                _shellWindow?.UpdateBalance(balance);
            });
        };

        _wsService.OnStartSession += (sessionId, remainingSeconds, tariffName, customerName, clientBalance) =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = true;
                // 1. Reset & Hide Lock Screen
                _lockWindow?.ResetFields();
                UnlockScreen();

                // 2. Open Shell Window gracefully with fallback
                if (_shellWindow == null || !_shellWindow.IsLoaded)
                {
                    _shellWindow = new ShellWindow();
                    _shellWindow.OnLogoutRequested += () => _ = _wsService?.SendLogoutAsync();
                    _shellWindow.OnAdminCallRequested += pc => System.Diagnostics.Debug.WriteLine($"[AdminCall] {pc} adminni chaqirdi.");
                    _shellWindow.OnBarOrderSubmitted += (summary, total) => System.Diagnostics.Debug.WriteLine($"[BarOrder] {summary} — {total} UZS");
                }

                _shellWindow.UpdateSessionData(remainingSeconds, tariffName, _wsService.PcNumber, customerName, clientBalance);
                _shellWindow.WindowState = WindowState.Maximized;
                _shellWindow.Topmost = false; // So games can run above it
                _shellWindow.Show();
                _shellWindow.Activate();
                _shellWindow.Focus();

                // 3. Time Widget
                if (clientBalance.HasValue && clientBalance.Value > 0)
                {
                    _timeWidget?.StartMemberSession(customerName, clientBalance.Value, remainingSeconds, _wsService.PcNumber);
                }
                else
                {
                    _timeWidget?.StartStandardSession(remainingSeconds, tariffName, _wsService.PcNumber, customerName);
                }
            });
        };

        _wsService.OnUpdateTime += remainingSeconds =>
        {
            _timeWidget?.UpdateTime(remainingSeconds);
            _shellWindow?.UpdateTime(remainingSeconds);
        };

        _wsService.OnStopSession += reason =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = false;
                _timeWidget?.StopSession();
                _shellWindow?.StopSession();
                _lockWindow?.ResetFields();
                LockScreen();
                ProcessCleaner.CleanGameProcesses();
                AutoUpdateService.Instance.OnSessionEnded();
            });
        };

        _wsService.OnPowerCommand += action =>
        {
            Dispatcher.Invoke(() => HandlePowerCommand(action));
        };

        // ---- 10.5. SaaS Anti-Piracy & Remote Kill-Switch Enforcer ----
        _wsService.OnEmergencyLockdown += (reason, message) =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = false;
                try { ProcessCleaner.CleanGameProcesses(); } catch { }
                _timeWidget?.StopSession();
                _shellWindow?.StopSession();
                KeyboardHook.Start();
                TaskManagerBlocker.EnableRestrictions();
                LockWindow.HideWindowsTaskbar();
                LockScreen();
                _lockWindow?.ShowEmergencyLockdown(reason, message);
            });
        };

        // ---- 11. WebSocket ulanishni boshlash ----
        _wsService.Start();

        // ---- 12. OTA Auto-Update Service ----
        AutoUpdateService.Instance.Initialize(null, () => _isSessionActive);
        AutoUpdateService.Instance.OnUpdatePendingSession += ver =>
        {
            Dispatcher.Invoke(() => _shellWindow?.ShowUpdatePendingNotice(ver));
        };
        AutoUpdateService.Instance.StartPeriodicChecks(TimeSpan.FromMinutes(15));
    }

    // -----------------------------------------------------------------------
    // Admin Commands & Maintenance
    // -----------------------------------------------------------------------

    /// <summary>
    /// Admin tomonidan kioskni butunlay xavfsiz yopish (Chiqish)
    /// </summary>
    public void AdminGracefulExit()
    {
        try
        {
            WatchdogService.RequestGracefulShutdown();
            KeyboardHook.Stop();
            TaskManagerBlocker.DisableRestrictions();
            LockWindow.ShowWindowsTaskbar();
            try { UsbGuardService.Instance.RestoreRegistryPolicies(); } catch { }

            _displayMgr?.Dispose();
            if (_lockWindow != null)
            {
                _lockWindow.IsAllowClosing = true;
                _lockWindow.Close();
            }

            _maintenanceToolbar?.Close();
            _shellWindow?.Close();
            _timeWidget?.Close();

            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();

            Shutdown(0);
        }
        catch
        {
            Environment.Exit(0);
        }
    }

    /// <summary>
    /// Admin texnik rejimi — qulfni vaqtinchalik yashirib, ekranni ochish
    /// </summary>
    public void EnableMaintenanceMode()
    {
        try
        {
            _lockWindow?.Hide();
            _displayMgr?.HideLock();
            KeyboardHook.Stop();
            LockWindow.ShowWindowsTaskbar();
            TaskManagerBlocker.DisableRestrictions();

            _maintenanceToolbar?.SetPcInfo(_wsService?.PcNumber ?? 1);
            _maintenanceToolbar?.Show();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Maintenance] Xato: {ex.Message}");
        }
    }

    /// <summary>
    /// Kiosk konfiguratsiyasini saqlash va yangilash
    /// </summary>
    public void SaveConfiguration(int pcNumber, string serverUrl)
    {
        _wsService?.UpdateConfig(pcNumber, serverUrl);
        _lockWindow?.SetPcNumber(pcNumber);
        _maintenanceToolbar?.SetPcInfo(pcNumber);
    }

    // -----------------------------------------------------------------------
    // Power Command Handler
    // -----------------------------------------------------------------------
    private void HandlePowerCommand(string action)
    {
        switch (action)
        {
            case "SHUTDOWN":
                ProcessCleaner.CleanGameProcesses();
                ExecuteShutdown("/s /t 2 /f /c \"Softech Admin buyrug'i bilan o'chirilmoqda\"");
                break;

            case "REBOOT":
                ProcessCleaner.CleanGameProcesses();
                ExecuteShutdown("/r /t 2 /f /c \"Softech Admin buyrug'i bilan qayta ishga tushirilmoqda\"");
                break;

            case "LOCK":
                _timeWidget?.StopSession();
                LockScreen();
                break;

            case "UNLOCK":
                UnlockScreen();
                break;
        }
    }

    private static void ExecuteShutdown(string arguments)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName        = "shutdown",
                Arguments       = arguments,
                CreateNoWindow  = true,
                UseShellExecute = false
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PowerCmd] xato: {ex.Message}");
        }
    }

    // -----------------------------------------------------------------------
    // Lock / Unlock Screen
    // -----------------------------------------------------------------------
    private void LockScreen()
    {
        _isSessionActive = false;
        // 1. Vidjet va ShellWindow yashirish
        _timeWidget?.StopSession();
        _shellWindow?.StopSession();
        _maintenanceToolbar?.Hide();

        if (IsDevMode)
        {
            // Dev rejimda faqat bitta standart oynada ko'rsatish
            if (_lockWindow != null)
            {
                _lockWindow.WindowStyle = WindowStyle.SingleBorderWindow;
                _lockWindow.ResizeMode = ResizeMode.CanResize;
                _lockWindow.Width = 1280;
                _lockWindow.Height = 760;
                _lockWindow.WindowState = WindowState.Normal;
                _lockWindow.WindowStartupLocation = WindowStartupLocation.CenterScreen;
                _lockWindow.Topmost = false;
                _lockWindow.ShowInTaskbar = true;
                _lockWindow.Show();
                _lockWindow.Activate();
            }
            KeyboardHook.Start();
        }
        else
        {
            // 2. Production qulf oynasini ko'rsatish (DisplayLockManager orqali)
            _displayMgr?.ShowLock();

            // 3. Klaviatura hookini yoqish
            KeyboardHook.Start();

            // 4. Task Manager va tizim cheklovlarini yoqish
            TaskManagerBlocker.EnableRestrictions();
        }
    }

    private void UnlockScreen()
    {
        // 1. Qulf oynasini yashirish
        _displayMgr?.HideLock();
        if (_lockWindow != null)
        {
            _lockWindow.Hide();
        }
        _maintenanceToolbar?.Hide();

        // 2. Klaviaturani ochish
        KeyboardHook.Stop();

        // 3. Task Manager cheklovlarini olib tashlash va Taskbarni ko'rsatish
        TaskManagerBlocker.DisableRestrictions();
        LockWindow.ShowWindowsTaskbar();
    }

    // -----------------------------------------------------------------------
    // OnExit — Tizimni asl holatiga qaytarish
    // -----------------------------------------------------------------------
    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _wsService?.Stop();
            KeyboardHook.Stop();
            TaskManagerBlocker.DisableRestrictions();
            LockWindow.ShowWindowsTaskbar();
            _displayMgr?.Dispose();

            _shellWindow?.Close();
            _maintenanceToolbar?.Close();

            UsbGuardService.Instance.Dispose();
            ProcessGuardService.Instance.Dispose();

            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
        }
        catch { /* ignore */ }

        base.OnExit(e);
    }
}
