using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Diagnostics;
using System.Threading;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Softech.Updates;

namespace SoftechCockpit;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private readonly NodeProcessManager _nodeManager = new();
    private bool _isInitialized;
    private bool _initializing;
    private bool _closing;
    private string _uiErrorCode="NONE";
    public bool SystemShutdown { get; set; }
    private readonly CancellationTokenSource _lifetime = new();
    private readonly DispatcherTimer _backendTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _diagnosticTimer = new() { Interval = TimeSpan.FromSeconds(60) };
    private readonly ServerDiagnostics _diagnostics = new();
    private bool _diagnosticBusy;
    private readonly BackendRecovery _recovery;
    private UpdateMonitor? _updateMonitor;
    private HwndSource? _windowSource;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _windowSource = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
        _windowSource?.AddHook(WindowMessageHook);
    }

    private IntPtr WindowMessageHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == 0x0024 && WindowWorkArea.Apply(hwnd, lParam)) // WM_GETMINMAXINFO
            handled = true;
        return IntPtr.Zero;
    }

    protected override void OnClosed(EventArgs e)
    {
        _windowSource?.RemoveHook(WindowMessageHook);
        base.OnClosed(e);
    }

    public MainWindow()
    {
        InitializeComponent();

        _recovery = new BackendRecovery(() => _nodeManager.HasUnexpectedExit,
            () => _closing || _initializing || _updateMonitor?.IsUpdateShutdown == true || _updateMonitor?.HasPendingHandover() == true,
            async () => {
                _nodeManager.GetExitDiagnostic();
                OnNodeStatusChanged("Server tiklanmoqda. Saqlangan seanslar qayta yuklanadi...");
                LoadingOverlay.Visibility = Visibility.Visible;
                ErrorOverlay.Visibility = Visibility.Collapsed;
                _isInitialized = false;
                await InitializeCockpitAsync();
            }, ShowError);
        _backendTimer.Tick += async (_, _) => await _recovery.TickAsync();
        _diagnosticTimer.Tick += async (_, _) => await ReportDiagnosticAsync();

        _nodeManager.StatusChanged += OnNodeStatusChanged;
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
        StateChanged += MainWindow_StateChanged;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        _updateMonitor = new UpdateMonitor(_nodeManager.ServerDirectory, () => System.Windows.Application.Current.Shutdown());
        _backendTimer.Start();
        _diagnosticTimer.Start();
        await InitializeCockpitAsync();
        await ReportDiagnosticAsync();
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Ordinary close keeps the backend and diagnostics alive. During an OTA
        // handover Node owns graceful shutdown; Windows sign-out may end both.
        bool updating = _updateMonitor?.IsUpdateShutdown == true;
        if(!updating&&!SystemShutdown&&!_nodeManager.ServiceInstalled){
            e.Cancel=true;WindowState=WindowState.Minimized;return;
        }
        _closing = true;
        _backendTimer.Stop();
        _diagnosticTimer.Stop();
        _lifetime.Cancel();
        _updateMonitor?.Dispose();
        _nodeManager.StopNodeServer(forUpdate: updating);
    }

    private void MainWindow_StateChanged(object? sender, EventArgs e)
    {
        // Maximize va Restore ikonkasini yangilash
        if (TxtMaximizeIcon != null)
        {
            TxtMaximizeIcon.Text = WindowState == WindowState.Maximized ? "❐" : "口";
        }
    }

    /// <summary>
    /// Node.js serverni tekshirish, start qilish va WebView2 ni initsializatsiya qilish.
    /// </summary>
    private async Task InitializeCockpitAsync()
    {
        if (_isInitialized || _initializing || _closing) return;
        _initializing = true;
        _uiErrorCode="NONE";
        BtnRetry.IsEnabled = false;

        LoadingOverlay.Visibility = Visibility.Visible;
        ErrorOverlay.Visibility = Visibility.Collapsed;

        try
        {
            if(Environment.GetEnvironmentVariable("SOFTECH_RECOVERY_FAILED")=="1") {
                Environment.SetEnvironmentVariable("SOFTECH_RECOVERY_FAILED",null);
                throw new IOException("UPDATE_RECOVERY_REQUIRED: Tiklash yakunlanmadi. Hisoblar taxminiy baza bilan almashtirilmadi. Tafsilotlar: logs/updater.log. Diagnostikani saqlang yoki Qayta urinishni bosing.");
            }
            if(!_nodeManager.ServiceInstalled&&await RecoveryHandover.PrepareAsync(_nodeManager.ServerDirectory,Environment.ProcessPath!,_lifetime.Token)) {
                // The recovery helper waits for this launcher to release its EXE.
                // Its probationary Node child has never accepted business writes.
                SystemShutdown=true;
                System.Windows.Application.Current.Shutdown();
                return;
            }
            // 1. Node.js backend ishga tushirish (Health-Check orqali)
            bool serverReady = await _nodeManager.EnsureServerRunningAsync(_lifetime.Token);
            if (_closing) return;

            if (!serverReady)
            {
                ShowError("Server bilan aloqa o'rnatib bo'lmadi.");
                return;
            }

            OnNodeStatusChanged("Interfeys yuklanmoqda...");

            // 2. WebView2 muhitini sozlash (Kesh va profil papkasi)
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userDataFolder = Path.Combine(localAppData, "SoftechCockpit", "WebView2Data");
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await CockpitWebView.EnsureCoreWebView2Async(env);

            // 3. Strict Kiosk / Native Desktop sozlamalari
            var settings = CockpitWebView.CoreWebView2.Settings;

#if DEBUG
            settings.AreDevToolsEnabled = true;
#else
            settings.AreDevToolsEnabled = false; // Kassirlar konsolga kirmasligi uchun
#endif

            settings.AreDefaultContextMenusEnabled = false; // "Inspect / Reload" o'ng tugma menyusi bloklangan
            settings.IsStatusBarEnabled = false;            // Pastki chap burchakdagi URL havolalarini yashirish
            settings.IsZoomControlEnabled = false;          // Masshtab o'zgarishini bloklash
            settings.AreBrowserAcceleratorKeysEnabled = true; // Ctrl+F5 va h.k. zaruratga qarab

            // Oq miltillashning (white flash) oldini olish uchun fon rangi
            CockpitWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(9, 9, 11);

            // 4. Navigatsiya yakunlanganda Splash ekranni yumshoq yashirish
            CockpitWebView.NavigationCompleted -= CockpitWebView_NavigationCompleted;
            CockpitWebView.NavigationCompleted += CockpitWebView_NavigationCompleted;

            // 5. Asosiy Kassa Dashboard manziliga yo'naltirish
            CockpitWebView.CoreWebView2.Navigate(NodeProcessManager.ServerUrl);
            _isInitialized = true;
        }
        catch (Exception ex)
        {
            if (!_closing) ShowError(ex.Message);
        }
        finally { _initializing = false; BtnRetry.IsEnabled = true; }
    }

    private void CockpitWebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            // Loading Overlay ni yumshoq fade-out qilish
            var anim = new DoubleAnimation(1.0, 0.0, TimeSpan.FromMilliseconds(300));
            anim.Completed += (s, args) =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
                LoadingOverlay.Opacity = 1.0;
            };
            LoadingOverlay.BeginAnimation(OpacityProperty, anim);
        }
        else
        {
            ShowError($"Veb-sahifani ochib bo'lmadi (Xatolik: {e.WebErrorStatus})");
        }
    }

    private void OnNodeStatusChanged(string status)
    {
        Dispatcher.Invoke(() =>
        {
            if (TxtLoadingStatus != null)
            {
                TxtLoadingStatus.Text = status;
            }
        });
    }

    private void ShowError(string message)
    {
        _uiErrorCode=ServerDiagnostics.Classify(message);
        Dispatcher.Invoke(() =>
        {
            LoadingOverlay.Visibility = Visibility.Collapsed;
            ErrorOverlay.Visibility = Visibility.Visible;
            if (TxtErrorMessage != null)
            {
                TxtErrorMessage.Text = message;
            }
            BtnEmergencyMode.Visibility=_nodeManager.ServiceInstalled?Visibility.Visible:Visibility.Collapsed;
        });
        _ = ReportDiagnosticAsync();
    }

    private async Task<System.Collections.Generic.Dictionary<string, object?>> CollectDiagnosticAsync()
    {
        bool healthy = await _nodeManager.IsServerHealthyAsync();
        string code=_uiErrorCode!="NONE"&&_uiErrorCode!="UNKNOWN"?_uiErrorCode:_nodeManager.DiagnosticCode;
        string state = healthy ? "RUNNING" : code != "NONE" ? "FAILED" : _initializing ? "STARTING" : "UNREACHABLE";
        return await Task.Run(() => ServerDiagnostics.Collect(_nodeManager.ServerDirectory, state, healthy ? "NONE" : code));
    }

    private async Task ReportDiagnosticAsync()
    {
        if (_closing || _diagnosticBusy || _updateMonitor?.IsUpdateShutdown == true) return;
        _diagnosticBusy = true;
        try { if(!_nodeManager.ServiceInstalled)await _diagnostics.SendAsync(_nodeManager.ServerDirectory, await CollectDiagnosticAsync(), _lifetime.Token); }
        catch { /* Diagnostics must never block startup, retries or cashier work. */ }
        finally { _diagnosticBusy = false; }
    }

    private async void BtnDiagnostics_Click(object sender, RoutedEventArgs e)
    {
        try {
            var report = await CollectDiagnosticAsync();
            var dialog = new Microsoft.Win32.SaveFileDialog { FileName = "Softech-Diagnostics.json", Filter = "JSON (*.json)|*.json" };
            if (dialog.ShowDialog(this) == true)
                File.WriteAllText(dialog.FileName, ServerDiagnostics.Export(report), System.Text.Encoding.UTF8);
        } catch { MessageBox.Show(this, "Diagnostikani saqlab bo'lmadi. Boshqa papkani tanlang.", "Softech"); }
    }

    private async void BtnRetry_Click(object sender, RoutedEventArgs e)
    {
        _isInitialized = false;
        await InitializeCockpitAsync();
    }

    private async void BtnBrowser_Click(object sender, RoutedEventArgs e)
    {
        if (!await _nodeManager.IsServerHealthyAsync()) {
            ShowError("Server hali tayyor emas. Avval Qayta urinish tugmasini bosing.");
            return;
        }
        try {
            Process.Start(new ProcessStartInfo(NodeProcessManager.ServerUrl) { UseShellExecute = true });
            TxtErrorMessage.Text = "Kassa brauzerda ochildi. Ushbu oynani kichraytirishingiz mumkin — server ishlashda davom etadi.";
        } catch (Exception error) { ShowError(error.Message); }
    }

    private async void BtnEmergencyMode_Click(object sender, RoutedEventArgs e)
    {
        if(!_nodeManager.ServiceInstalled){ShowError("Favqulodda rejim uchun yangi Server setup orqali Windows xizmatini o'rnating.");return;}
        BtnEmergencyMode.IsEnabled=false;
        try {
            string request=Softech.Updates.PackageManifest.ChildPath(_nodeManager.ServerDirectory,".service/emergency.request");
            await Task.Run(()=>Softech.Updates.UpdateJournal.Write(request,new{requestedAt=DateTimeOffset.UtcNow,launcherPid=Environment.ProcessId}));
            TxtErrorMessage.Text="Favqulodda rejim tayyorlanmoqda. Clientlar qayta ulanadi...";
            var deadline=DateTimeOffset.UtcNow.AddSeconds(45);
            while(DateTimeOffset.UtcNow<deadline){
                if(await _nodeManager.IsServerHealthyAsync()){_isInitialized=false;await InitializeCockpitAsync();return;}
                await Task.Delay(500);
            }
            ShowError("Favqulodda rejim ochilmadi. Litsenziya, runtime, 5000-port va disk holatini diagnostikadan tekshiring.");
        }catch(Exception error){ShowError("Favqulodda rejim so'rovi bajarilmadi: "+error.Message);}
        finally{BtnEmergencyMode.IsEnabled=true;}
    }

    // ========================================================================
    // Custom Chrome Header & Window Controls
    // ========================================================================

    private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            // Sarlavha ustiga 2 marta bosilganda oynani kattalashtirish / tiklash
            BtnMaximize_Click(sender, e);
        }
        else if (e.LeftButton == MouseButtonState.Pressed)
        {
            // Oynani surish (Drag Move)
            DragMove();
        }
    }

    private void BtnMinimize_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void BtnMaximize_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState == WindowState.Maximized 
            ? WindowState.Normal 
            : WindowState.Maximized;
    }

    private void BtnClose_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
