using System;
using System.Threading;
using System.Windows;
using NetCafeClient.Services;
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
    private readonly System.Collections.Generic.List<AdminMessageWindow> _adminMessages = new();
    private LockWindow?               _lockWindow;
    private TimeWidgetWindow?         _timeWidget;
    private MaintenanceToolbarWindow? _maintenanceToolbar;

    // ---- Services ----
    private WebSocketClientService? _wsService;
    private DisplayLockManager?     _displayMgr;
    private bool                    _isSessionActive = false;
    private bool _isMaintenance;

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

        // Helper processes must not acquire the main mutex or alter kiosk restrictions.
        if (Array.Exists(args, arg => arg.StartsWith("--watchdog-parent=", StringComparison.Ordinal)))
        {
            WatchdogService.Initialize(args);
            return;
        }

        // ---- 1. Single-instance tekshiruvi ----
        bool isNew;
        _instanceMutex = new Mutex(initiallyOwned: true, "NetCafeClient_TekirQulf_Mutex", out isNew);

        if (!isNew)
        {
            // Boshqa nusxa allaqachon ishlayapti
            System.Windows.MessageBox.Show("NetCafeClient allaqachon ishlamoqda.", "Xabar", MessageBoxButton.OK, MessageBoxImage.Information);
            _instanceMutex.Dispose();
            _instanceMutex = null;
            Shutdown();
            return;
        }

        // Dastur qanday yopilishidan qat'i nazar (Ctrl+C yoki taskkill) Taskbarni tiklash kafolati
        AppDomain.CurrentDomain.ProcessExit += (s, ev) =>
        {
            LockWindow.ShowWindowsTaskbar();
            TaskManagerBlocker.DisableRestrictions();
        };


        if (!IsDevMode && !Array.Exists(args, arg => arg == "--update-health"))
        {
            WatchdogService.Initialize(args);
        }

        // ---- 3. Oynalar yaratish ----
        _lockWindow = new LockWindow();
        _timeWidget = new TimeWidgetWindow();
        _maintenanceToolbar = new MaintenanceToolbarWindow();

        // MaintenanceToolbar hodisalariga ulanish
        _maintenanceToolbar.OnRelockRequested += () => Dispatcher.Invoke(LockScreen);
        _maintenanceToolbar.OnSettingsRequested += () => Dispatcher.Invoke(() => _lockWindow?.OpenAdminMaintenanceModal());
        _maintenanceToolbar.OnExitRequested += () => Dispatcher.Invoke(AdminGracefulExit);

        // ---- 4. KeyboardHook ga LockWindow ni bildirish ----
        KeyboardHook.LockWindowRef = new WeakReference<LockWindow>(_lockWindow);

        // ---- 5. DisplayLockManager ----
        _displayMgr = new DisplayLockManager(_lockWindow);

        // Lock-only mode leaves the club's shell, USB policy and launchers alone.
        // Keyboard and Task Manager restrictions are applied only while locked.

        // ---- 6. Dastur ochilishi bilanoq ekranni qulflash ----
        LockScreen();

        // ---- 7. WebSocket xizmatini initsializatsiya qilish ----
        _wsService = new WebSocketClientService();
        _lockWindow.SetPcNumber(_wsService.PcNumber);
        _maintenanceToolbar.SetPcInfo(_wsService.PcNumber);

        // ---- 8. LockWindow login va QR hodisalari ----
        _lockWindow.OnLoginRequested += (username, password, minutes) =>
        {
            if (!_wsService.IsConnected) { _lockWindow.ShowError("Server bilan aloqa yo‘q. Ulanishni tekshiring va qayta kiring."); return; }
            _ = _wsService.SendMemberLoginAsync(username, password, minutes);
        };

        _lockWindow.OnQrRefreshRequested += () =>
        {
            _ = _wsService.SendQrRefreshRequestAsync();
        };

        // ---- 9. TimeWidget logout hodisalari ----
        _timeWidget.UpdateAccount = _wsService.UpdateAccountAsync;
        _timeWidget.OnLogoutRequested += async () =>
        {
            if (!_wsService.CanSelfClose) return;
            _timeWidget.SetLogoutPending(true);
            try
            {
                if (!await _wsService.SendLogoutAsync())
                    System.Windows.MessageBox.Show("Server seans yopilganini tasdiqlamadi. Qayta urinib ko‘ring yoki kassirga murojaat qiling.", "Seansni yakunlash");
            }
            finally { _timeWidget.SetLogoutPending(false); }
        };
        _timeWidget.OnSessionExpired += () => Dispatcher.Invoke(() =>
        {
            // The local monotonic timer also protects a PC disconnected from LAN.
            _lockWindow?.ResetFields();
            LockScreen();
            if (_wsService.CanSelfClose) _ = _wsService.SendLogoutAsync();
        });

        // ---- 10. WebSocket hodisalariga ulanish ----

        _wsService.OnConnectionStatusChanged += isConnected =>
        {
            Dispatcher.Invoke(() =>
            {
                _lockWindow?.SetServerStatus(isConnected);
                _timeWidget?.SetServerConnected(isConnected);
            });
        };

        _wsService.OnPcConfigReceived += (zoneName, pricePerHour, formattedRate, qrToken) =>
        {
            Dispatcher.Invoke(() =>
            {
                _lockWindow?.SetZoneInfo(zoneName, pricePerHour, formattedRate);
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
            if (!_wsService.CanSelfClose) return;
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = true;
                _lockWindow?.ResetFields();
                UnlockScreen();
                _timeWidget?.StartMemberSession(username, balance, remainingSeconds, _wsService.PcNumber);
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

                // Reveal the existing Windows desktop or third-party shell.
                // 3. Time Widget
                if (_wsService.CanSelfClose && clientBalance.HasValue)
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
        };
        _wsService.OnSessionInfo += info => _timeWidget?.UpdateSessionInfo(info);

        _wsService.OnStopSession += reason =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = false;
                _timeWidget?.StopSession();
                _lockWindow?.ResetFields();
                LockScreen();
                AutoUpdateService.Instance.OnSessionEnded();
            });
        };

        _wsService.OnAdminMessage += (title, message) => Dispatcher.Invoke(() => {
            var notice = new NetCafeClient.Views.AdminMessageWindow(title, message);
            _adminMessages.Add(notice);
            notice.Closed += (_, _) => _adminMessages.Remove(notice);
            if (_lockWindow?.IsVisible == true) notice.Owner = _lockWindow;
            notice.Show();
        });

        _wsService.OnSessionBarNotice += (sessionId, message, amount) =>
            _ = ShowSessionBarNoticeAfterLockAsync(sessionId, message, amount);
        _wsService.OnMemberSessionEnded += summary =>
            Dispatcher.Invoke(() => _lockWindow?.ShowMemberSessionSummary(summary));

        _wsService.OnPowerCommand += action =>
        {
            Dispatcher.Invoke(() => HandlePowerCommand(action));
        };
        _wsService.OnForceClientUpdate += (commandId, targetVersion) =>
            _ = AutoUpdateService.Instance.ForceCheckAsync(commandId, targetVersion);

        // ---- 10.5. SaaS Anti-Piracy & Remote Kill-Switch Enforcer ----
        _wsService.OnEmergencyLockdown += (reason, message) =>
        {
            Dispatcher.Invoke(() =>
            {
                _isSessionActive = false;
                _timeWidget?.StopSession();
                KeyboardHook.Start();
                TaskManagerBlocker.EnableRestrictions();
                LockWindow.HideWindowsTaskbar();
                LockScreen();
                _lockWindow?.ShowEmergencyLockdown(reason, message);
            });
        };

        // ---- 11. OTA holati birinchi handshake ichida ham aniq bo'lishi kerak ----
        AutoUpdateService.Instance.Initialize(null, () => _isSessionActive, () => _isMaintenance);
        AutoUpdateService.Instance.StartPeriodicChecks(TimeSpan.FromSeconds(60));

        // ---- 12. WebSocket ulanishni boshlash ----
        _wsService.Start();
        int healthArg = Array.IndexOf(args, "--update-health");
        if (healthArg >= 0 && healthArg + 1 < args.Length)
        {
            System.IO.File.WriteAllText(args[healthArg + 1], "ready");
            // The updater owns crash recovery until its health check completes.
            _ = System.Threading.Tasks.Task.Run(async () =>
            {
                await System.Threading.Tasks.Task.Delay(TimeSpan.FromSeconds(12));
                AutoUpdateService.Instance.ConfirmInstalled();
                await System.Threading.Tasks.Task.Delay(TimeSpan.FromSeconds(33));
                if (!IsDevMode) WatchdogService.Initialize(Array.Empty<string>());
            });
        }
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

            _displayMgr?.Dispose();
            if (_lockWindow != null)
            {
                _lockWindow.IsAllowClosing = true;
                _lockWindow.Close();
            }

            _maintenanceToolbar?.Close();
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
        _isMaintenance = true;
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
                ExecuteShutdown("/s /t 2 /f /c \"Softech Admin buyrug'i bilan o'chirilmoqda\"");
                break;

            case "REBOOT":
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
        if (IsDevMode) return; // One-PC testing must never power off the host.
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

    private async System.Threading.Tasks.Task ShowSessionBarNoticeAfterLockAsync(string sessionId, string message, double amount)
    {
        // STOP_SESSION and LOCK_SCREEN arrive back-to-back. Let the lock screen
        // finish resetting first, otherwise its redraw can immediately hide the
        // checkout notice. A newly-started session must never receive an old notice.
        await System.Threading.Tasks.Task.Delay(250);
        await Dispatcher.InvokeAsync(() =>
        {
            if (!_isSessionActive)
                _lockWindow?.ShowSessionBarNotice(sessionId, message, amount);
        });
    }

    // -----------------------------------------------------------------------
    // Lock / Unlock Screen
    // -----------------------------------------------------------------------
    private void LockScreen()
    {
        _isMaintenance = false;
        _isSessionActive = false;
        // 1. Vidjetni yashirish
        _timeWidget?.StopSession();
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
        if (_lockWindow?.IsVisible == true)
            foreach (var notice in _adminMessages) { notice.Owner = _lockWindow; notice.Show(); }
    }

    private void UnlockScreen()
    {
        // Keep messages visible when their lock-screen owner is hidden.
        foreach (var notice in _adminMessages) notice.Owner = null;
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
        if (_instanceMutex == null)
        {
            base.OnExit(e);
            return;
        }

        try
        {
            AutoUpdateService.Instance.Stop();
            _wsService?.Stop();
            KeyboardHook.Stop();
            TaskManagerBlocker.DisableRestrictions();
            LockWindow.ShowWindowsTaskbar();
            _displayMgr?.Dispose();

            _maintenanceToolbar?.Close();


            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
        }
        catch { /* ignore */ }

        base.OnExit(e);
    }
}
