using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using Microsoft.Web.WebView2.Core;

namespace SoftechCockpit;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private readonly NodeProcessManager _nodeManager = new();
    private bool _isInitialized;

    public MainWindow()
    {
        InitializeComponent();

        _nodeManager.StatusChanged += OnNodeStatusChanged;
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
        StateChanged += MainWindow_StateChanged;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await InitializeCockpitAsync();
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Standalone oynasi yopilganda fondagi Node.js serverni toza to'xtatish
        _nodeManager.StopNodeServer();
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
        if (_isInitialized) return;

        LoadingOverlay.Visibility = Visibility.Visible;
        ErrorOverlay.Visibility = Visibility.Collapsed;

        try
        {
            // 1. Node.js backend ishga tushirish (Health-Check orqali)
            bool serverReady = await _nodeManager.EnsureServerRunningAsync();

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
            CockpitWebView.NavigationCompleted += CockpitWebView_NavigationCompleted;

            // 5. Asosiy Kassa Dashboard manziliga yo'naltirish
            CockpitWebView.Source = new Uri(NodeProcessManager.ServerUrl);
            _isInitialized = true;
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
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
        Dispatcher.Invoke(() =>
        {
            LoadingOverlay.Visibility = Visibility.Collapsed;
            ErrorOverlay.Visibility = Visibility.Visible;
            if (TxtErrorMessage != null)
            {
                TxtErrorMessage.Text = message;
            }
        });
    }

    private async void BtnRetry_Click(object sender, RoutedEventArgs e)
    {
        _isInitialized = false;
        await InitializeCockpitAsync();
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
