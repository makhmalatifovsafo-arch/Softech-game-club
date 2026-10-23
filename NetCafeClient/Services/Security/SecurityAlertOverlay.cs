using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;

using WpfColor = System.Windows.Media.Color;
using WpfBrushes = System.Windows.Media.Brushes;
using WpfOrientation = System.Windows.Controls.Orientation;
using WpfHorizontalAlignment = System.Windows.HorizontalAlignment;

namespace NetCafeClient.Services.Security;

/// <summary>
/// Ekranda yuqori ustuvorlikdagi qizil xavfsizlik ogohlantirishini (Overlay Banner)
/// ko'rsatuvchi mustaqil WPF darchasi.
/// Fleshka tiqilganda yoki shubhali fayllar aniqlanganda ekranning yuqori qismida chiqadi.
/// </summary>
public class SecurityAlertOverlay : Window
{
    private static SecurityAlertOverlay? _activeInstance;
    private static readonly object _lock = new();

    private readonly TextBlock _titleText;
    private readonly TextBlock _messageText;
    private readonly DispatcherTimer _dismissTimer;

    public SecurityAlertOverlay()
    {
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = WpfBrushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        Focusable = false;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;

        // Ekranning yuqori o'rtasiga joylashtirish
        WindowStartupLocation = WindowStartupLocation.Manual;
        Top = 28;

        // Zamonaviy qizil Cyber-Security kartochkasi
        var border = new Border
        {
            Background = new SolidColorBrush(WpfColor.FromArgb(245, 20, 6, 10)),
            BorderBrush = new SolidColorBrush(WpfColor.FromRgb(225, 29, 72)), // Crimson Rose
            BorderThickness = new Thickness(2),
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(24, 16, 28, 16),
            MinWidth = 480,
            MaxWidth = 640,
            Effect = new DropShadowEffect
            {
                Color = WpfColor.FromRgb(225, 29, 72),
                BlurRadius = 32,
                ShadowDepth = 0,
                Opacity = 0.7
            }
        };

        var mainStack = new StackPanel { Orientation = WpfOrientation.Horizontal };

        // 1. Qizil neon ogohlantirish belgisi
        var iconBorder = new Border
        {
            Width = 48,
            Height = 48,
            CornerRadius = new CornerRadius(12),
            Background = new SolidColorBrush(WpfColor.FromArgb(50, 225, 29, 72)),
            BorderBrush = new SolidColorBrush(WpfColor.FromRgb(244, 63, 94)),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(0, 0, 16, 0),
            VerticalAlignment = VerticalAlignment.Center
        };

        var iconText = new TextBlock
        {
            Text = "⚠️",
            FontSize = 24,
            HorizontalAlignment = WpfHorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        iconBorder.Child = iconText;
        mainStack.Children.Add(iconBorder);

        // 2. Matn qismi
        var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

        var badgeText = new TextBlock
        {
            Text = "XAVFSIZLIK QOIDASI BUZILISHI",
            FontSize = 10,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(251, 113, 133)),
            Margin = new Thickness(0, 0, 0, 3)
        };
        textStack.Children.Add(badgeText);

        _titleText = new TextBlock
        {
            Text = "Xavfsizlik: Tashqi xotira vositalari (USB Fleshka) taqiqlangan!",
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = WpfBrushes.White,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 2)
        };
        textStack.Children.Add(_titleText);

        _messageText = new TextBlock
        {
            Text = "Qurilma avtomatik chiqarildi (Ejected). Klub siyosatiga ko'ra USB xotira taqiqlangan.",
            FontSize = 11,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(212, 212, 216)),
            TextWrapping = TextWrapping.Wrap
        };
        textStack.Children.Add(_messageText);

        mainStack.Children.Add(textStack);
        border.Child = mainStack;
        Content = border;

        // Avtomatik yopilish taymeri (4.5 soniya)
        _dismissTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4.5) };
        _dismissTimer.Tick += (s, e) =>
        {
            _dismissTimer.Stop();
            FadeOutAndClose();
        };

        Loaded += (s, e) =>
        {
            CenterHorizontally();
            FadeIn();
            _dismissTimer.Start();
        };
    }

    private void CenterHorizontally()
    {
        double screenWidth = SystemParameters.PrimaryScreenWidth;
        Left = (screenWidth - ActualWidth) / 2;
    }

    private void FadeIn()
    {
        Opacity = 0;
        var anim = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200));
        BeginAnimation(OpacityProperty, anim);
    }

    private void FadeOutAndClose()
    {
        var anim = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(250));
        anim.Completed += (s, e) =>
        {
            lock (_lock)
            {
                if (_activeInstance == this) _activeInstance = null;
            }
            Close();
        };
        BeginAnimation(OpacityProperty, anim);
    }

    /// <summary>
    /// Thread-safe tarzda ekranda qizil xavfsizlik ogohlantirishini ko'rsatish
    /// </summary>
    public static void ShowAlert(
        string title = "Xavfsizlik: Tashqi xotira vositalari (USB Fleshka) taqiqlangan!",
        string message = "Qurilma avtomatik chiqarildi (Ejected). Klub siyosatiga ko'ra USB xotira taqiqlangan.")
    {
        System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
        {
            lock (_lock)
            {
                try
                {
                    if (_activeInstance != null)
                    {
                        _activeInstance._titleText.Text = title;
                        _activeInstance._messageText.Text = message;
                        _activeInstance._dismissTimer.Stop();
                        _activeInstance._dismissTimer.Start();
                        _activeInstance.Activate();
                        return;
                    }

                    _activeInstance = new SecurityAlertOverlay();
                    _activeInstance._titleText.Text = title;
                    _activeInstance._messageText.Text = message;
                    _activeInstance.Show();
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[SecurityAlertOverlay] Xato: {ex.Message}");
                }
            }
        });
    }
}
