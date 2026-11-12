using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using NetCafeClient.Services.Security;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using Brushes = System.Windows.Media.Brushes;
using Button = System.Windows.Controls.Button;

namespace NetCafeClient;

/// <summary>
/// LockWindow.xaml.cs — Production Client Kiosk Lock Screen Code-Behind.
/// Lock-only login overlay. Unlocking reveals the club's existing desktop/shell.
/// Windows secure attention is managed by the OS, not by this window.
/// </summary>
public partial class LockWindow : Window, INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private string _activeHourlyRateDisplay = "10 000 UZS / soat";
    public string ActiveHourlyRateDisplay
    {
        get => _activeHourlyRateDisplay;
        set
        {
            if (_activeHourlyRateDisplay != value)
            {
                _activeHourlyRateDisplay = value;
                OnPropertyChanged(nameof(ActiveHourlyRateDisplay));
            }
        }
    }
    // =========================================================================
    // Win32 API Definitions for Taskbar and Topmost Confinement
    // =========================================================================
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string? lpWindowName);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    private static readonly System.Collections.Generic.Dictionary<IntPtr, bool> TaskbarVisibility = new();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_SHOWWINDOW = 0x0040;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    // =========================================================================
    // State Fields & Timers
    // =========================================================================
    private readonly DispatcherTimer _clockTimer;
    private readonly DispatcherTimer _qrCountdownTimer;
    private int _qrSecondsRemaining = 60;
    private string _currentQrToken = "";
    private int _currentPcNumber = 7;
    private string _currentLang = "UZ";
    private bool _isPasswordRevealed = false;

    // Events
    public event Action<string, string, int>? OnLoginRequested;
    public event Action? OnQrRefreshRequested;

    public LockWindow()
    {
        InitializeComponent();
        DataContext = this;

        // 1. Live Digital Clock & Date Timer (1s Interval)
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _clockTimer.Tick += ClockTimer_Tick;
        _clockTimer.Start();
        UpdateClockAndDate();

        // 2. Dynamic QR Countdown Timer
        _qrCountdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _qrCountdownTimer.Tick += QrCountdownTimer_Tick;

        // 3. Lifecycle & Anti-Escape hooks
        Loaded += LockWindow_Loaded;
        Deactivated += LockWindow_Deactivated;
        LostFocus += LockWindow_LostFocus;

        // 4. Load Wallpaper if present in Assets/
        LoadDynamicWallpaper();

        // 5. Initial QR code generation
        // QR sign-in is not exposed in lock-only mode.
    }

    // -------------------------------------------------------------------------
    // Anti-Escape & Desktop Lockdown
    // -------------------------------------------------------------------------
    private void LockWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (!App.IsDevMode)
        {
            HideWindowsTaskbar();
            EnforceTopmostFocus();
        }
        TxtPhone.Focus();
        TxtPhone.CaretIndex = TxtPhone.Text.Length;
    }

    private void LockWindow_Deactivated(object? sender, EventArgs e)
    {
        if (!App.IsDevMode && Visibility == Visibility.Visible)
        {
            EnforceTopmostFocus();
        }
    }

    private void LockWindow_LostFocus(object sender, RoutedEventArgs e)
    {
        if (!App.IsDevMode && Visibility == Visibility.Visible)
        {
            EnforceTopmostFocus();
        }
    }

    private void EnforceTopmostFocus()
    {
        if (App.IsDevMode) return;
        try
        {
            Topmost = true;
            Activate();
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd != IntPtr.Zero)
            {
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            }
        }
        catch { /* ignore */ }
    }

    public static void HideWindowsTaskbar()
    {
        if (App.IsDevMode) return;
        try
        {
            IntPtr hTray = FindWindow("Shell_TrayWnd", null);
            if (hTray != IntPtr.Zero)
            {
                TaskbarVisibility.TryAdd(hTray, IsWindowVisible(hTray));
                ShowWindow(hTray, SW_HIDE);
            }

            IntPtr hSecondaryTray = FindWindow("Shell_SecondaryTrayWnd", null);
            if (hSecondaryTray != IntPtr.Zero)
            {
                TaskbarVisibility.TryAdd(hSecondaryTray, IsWindowVisible(hSecondaryTray));
                ShowWindow(hSecondaryTray, SW_HIDE);
            }
        }
        catch { /* ignore */ }
    }

    public static void ShowWindowsTaskbar()
    {
        try
        {
            // Preserve a RunPad/custom shell that deliberately hides Explorer's taskbar.
            foreach (var entry in TaskbarVisibility)
                ShowWindow(entry.Key, entry.Value ? SW_SHOW : SW_HIDE);
            TaskbarVisibility.Clear();
        }
        catch { /* ignore */ }
    }

    public bool IsAllowClosing { get; set; } = false;

    protected override void OnClosing(CancelEventArgs e)
    {
        if (!IsAllowClosing && !App.IsDevMode)
        {
            // Standby Lock screen cannot be closed by standard OS methods
            e.Cancel = true;
            return;
        }
        base.OnClosing(e);
    }

    // -------------------------------------------------------------------------
    // Dynamic Background Wallpaper
    // -------------------------------------------------------------------------
    private void LoadDynamicWallpaper()
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] candidates =
            [
                Path.Combine(baseDir, "Assets", "wallpaper.jpg"),
                Path.Combine(baseDir, "Assets", "wallpaper.png"),
                Path.Combine(baseDir, "wallpaper.jpg"),
                Path.Combine(baseDir, "wallpaper.png")
            ];

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    BitmapImage bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.UriSource = new Uri(candidate, UriKind.Absolute);
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.EndInit();
                    bmp.Freeze();
                    ImgWallpaper.Source = bmp;
                    break;
                }
            }
        }
        catch { /* keep procedural cyber gradient */ }
    }

    // -------------------------------------------------------------------------
    // Live Clock & Date
    // -------------------------------------------------------------------------
    private void ClockTimer_Tick(object? sender, EventArgs e)
    {
        UpdateClockAndDate();
    }

    private void UpdateClockAndDate()
    {
        DateTime now = DateTime.Now;
        TxtClock.Text = now.ToString("HH:mm:ss");

        if (_currentLang == "RU")
            TxtDate.Text = now.ToString("d MMMM, yyyy", new CultureInfo("ru-RU"));
        else if (_currentLang == "EN")
            TxtDate.Text = now.ToString("MMMM d, yyyy", new CultureInfo("en-US"));
        else
            TxtDate.Text = now.ToString("d-MMMM, yyyy", new CultureInfo("uz-Latn-UZ"));
    }

    // -------------------------------------------------------------------------
    // Public Configuration API (Server sync)
    // -------------------------------------------------------------------------
    public void SetPcNumber(int pcNumber)
    {
        _currentPcNumber = pcNumber;
        Dispatcher.Invoke(() =>
        {
            TxtPcNumber.Text = $"PC-{pcNumber:D2}";
        });
    }

    public void SetZoneInfo(string zoneName, double pricePerHour, string? formattedRate = null)
    {
        Dispatcher.Invoke(() =>
        {
            TxtZoneBadge.Text = $"[ {zoneName.ToUpperInvariant()} ]";
            string displayRate = formattedRate ?? $"{pricePerHour:N0} UZS / soat".Replace(",", " ");
            ActiveHourlyRateDisplay = displayRate;
            TxtTariffRate.Text = displayRate;

            // Apply distinct neon border color based on zone
            if (zoneName.Contains("VIP", StringComparison.OrdinalIgnoreCase))
            {
                BorderZoneBadge.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#C084FC")!;
                TxtZoneBadge.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#E9D5FF")!;
            }
            else if (zoneName.Contains("BOOTCAMP", StringComparison.OrdinalIgnoreCase))
            {
                BorderZoneBadge.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#F43F5E")!;
                TxtZoneBadge.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#FDA4AF")!;
            }
            else
            {
                BorderZoneBadge.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#38BDF8")!;
                TxtZoneBadge.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#BAE6FD")!;
            }
        });
    }

    public void SetServerStatus(bool isConnected)
    {
        Dispatcher.Invoke(() =>
        {
            if (isConnected)
            {
                PillServerStatus.Background = (SolidColorBrush)new BrushConverter().ConvertFrom("#122B1E")!;
                PillServerStatus.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#10B981")!;
                TxtServerStatus.Text = "● ONLINE";
                TxtServerStatus.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#34D399")!;
            }
            else
            {
                PillServerStatus.Background = (SolidColorBrush)new BrushConverter().ConvertFrom("#2B1215")!;
                PillServerStatus.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#F43F5E")!;
                TxtServerStatus.Text = "○ OFFLINE";
                TxtServerStatus.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#FB7185")!;
            }
        });
    }

    // -------------------------------------------------------------------------
    // Tab Navigation: Phone Login vs Dynamic QR Login
    // -------------------------------------------------------------------------
    private void BtnTabPhone_Click(object sender, RoutedEventArgs e)
    {
        PanelPhoneLogin.Visibility = Visibility.Visible;
        PanelQrLogin.Visibility = Visibility.Collapsed;

        BtnTabPhone.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#22D3EE")!;
        BtnTabPhone.Background = (SolidColorBrush)new BrushConverter().ConvertFrom("#162032")!;
        BtnTabPhone.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#0891B2")!;

        BtnTabQr.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#64748B")!;
        BtnTabQr.Background = Brushes.Transparent;
        BtnTabQr.BorderBrush = Brushes.Transparent;

        _qrCountdownTimer.Stop();

        TxtPhone.Focus();
        TxtPhone.CaretIndex = TxtPhone.Text.Length;
    }

    private void BtnTabQr_Click(object sender, RoutedEventArgs e)
    {
        PanelPhoneLogin.Visibility = Visibility.Collapsed;
        PanelQrLogin.Visibility = Visibility.Visible;

        BtnTabQr.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#22D3EE")!;
        BtnTabQr.Background = (SolidColorBrush)new BrushConverter().ConvertFrom("#162032")!;
        BtnTabQr.BorderBrush = (SolidColorBrush)new BrushConverter().ConvertFrom("#0891B2")!;

        BtnTabPhone.Foreground = (SolidColorBrush)new BrushConverter().ConvertFrom("#64748B")!;
        BtnTabPhone.Background = Brushes.Transparent;
        BtnTabPhone.BorderBrush = Brushes.Transparent;

        StartQrCycle();
    }

    // -------------------------------------------------------------------------
    // Dynamic QR-Code Generation & Refresh Engine
    // -------------------------------------------------------------------------
    public void SetQrToken(string qrToken)
    {
        _currentQrToken = qrToken;
        Dispatcher.Invoke(() =>
        {
            RenderQrCode(qrToken);
            _qrSecondsRemaining = 60;
            TxtQrTimer.Text = $"⏳ {_qrSecondsRemaining}s";
        });
    }

    private void GenerateDefaultQrToken()
    {
        string token = $"SF-{Random.Shared.Next(1000, 9999)}-PC{_currentPcNumber:D2}";
        _currentQrToken = token;
        RenderQrCode($"softech://auth?token={token}&pc={_currentPcNumber}");
    }

    private void StartQrCycle()
    {
        if (string.IsNullOrEmpty(_currentQrToken))
        {
            GenerateDefaultQrToken();
        }
        else
        {
            RenderQrCode($"softech://auth?token={_currentQrToken}&pc={_currentPcNumber}");
        }

        _qrSecondsRemaining = 60;
        TxtQrTimer.Text = $"⏳ {_qrSecondsRemaining}s";
        _qrCountdownTimer.Start();
    }

    private void QrCountdownTimer_Tick(object? sender, EventArgs e)
    {
        _qrSecondsRemaining--;
        if (_qrSecondsRemaining <= 0)
        {
            _qrSecondsRemaining = 60;
            GenerateDefaultQrToken();
            OnQrRefreshRequested?.Invoke();
        }
        TxtQrTimer.Text = $"⏳ {_qrSecondsRemaining}s";
    }

    private void BtnRefreshQr_Click(object sender, RoutedEventArgs e)
    {
        _qrSecondsRemaining = 60;
        GenerateDefaultQrToken();
        OnQrRefreshRequested?.Invoke();
        TxtQrTimer.Text = $"⏳ {_qrSecondsRemaining}s";
    }

    private void RenderQrCode(string qrPayload)
    {
        try
        {
            TxtQrToken.Text = $"Token: {_currentQrToken}";
            var bmp = QrCodeGenerator.GenerateQrBitmap(qrPayload, 200);
            ImgQrCode.Source = bmp;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[QR Render Error]: {ex.Message}");
        }
    }

    // -------------------------------------------------------------------------
    // Phone Number Masking Engine (+998 (90) 123-45-67)
    // -------------------------------------------------------------------------
    private void TxtPhone_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            if (_isPasswordRevealed) TxtPasswordPlain.Focus();
            else TxtPassword.Focus();
        }
    }

    public static string NormalizeLogin(string input)
    {
        string value = input.Trim();
        return value.StartsWith("+", StringComparison.Ordinal)
            ? Regex.Replace(value, @"[\s()-]", "") : value;
    }

    private void AppendPhoneDigit(char digit)
    {
        string rawDigits = ExtractPhoneDigits(TxtPhone.Text);
        if (rawDigits.Length >= 9) return; // 9 digits after 998 max

        rawDigits += digit;
        TxtPhone.Text = FormatUzbekPhone(rawDigits);
        TxtPhone.CaretIndex = TxtPhone.Text.Length;
    }

    private void RemovePhoneDigit()
    {
        string rawDigits = ExtractPhoneDigits(TxtPhone.Text);
        if (rawDigits.Length > 0)
        {
            rawDigits = rawDigits.Substring(0, rawDigits.Length - 1);
            TxtPhone.Text = FormatUzbekPhone(rawDigits);
            TxtPhone.CaretIndex = TxtPhone.Text.Length;
        }
    }

    private static string ExtractPhoneDigits(string text)
    {
        // Strip everything except digits, ignoring prefix 998
        string digitsOnly = Regex.Replace(text, @"\D", "");
        if (digitsOnly.StartsWith("998") && digitsOnly.Length >= 3)
        {
            digitsOnly = digitsOnly.Substring(3);
        }
        return digitsOnly;
    }

    private static string FormatUzbekPhone(string raw)
    {
        StringBuilder sb = new StringBuilder("+998 ");
        if (raw.Length == 0) return sb.ToString();

        // (XX)
        sb.Append("(");
        if (raw.Length <= 2)
        {
            sb.Append(raw);
            return sb.ToString();
        }
        sb.Append(raw.Substring(0, 2)).Append(") ");

        // XXX
        if (raw.Length <= 5)
        {
            sb.Append(raw.Substring(2));
            return sb.ToString();
        }
        sb.Append(raw.Substring(2, 3)).Append("-");

        // XX
        if (raw.Length <= 7)
        {
            sb.Append(raw.Substring(5));
            return sb.ToString();
        }
        sb.Append(raw.Substring(5, 2)).Append("-");

        // XX
        sb.Append(raw.Substring(7, Math.Min(2, raw.Length - 7)));
        return sb.ToString();
    }

    public string GetCleanPhoneNumber()
    {
        string raw = ExtractPhoneDigits(TxtPhone.Text);
        return $"+998{raw}";
    }

    // -------------------------------------------------------------------------
    // Password Reveal / Hide Toggle
    // -------------------------------------------------------------------------
    private void BtnTogglePassword_Click(object sender, RoutedEventArgs e)
    {
        _isPasswordRevealed = !_isPasswordRevealed;

        if (_isPasswordRevealed)
        {
            TxtPasswordPlain.Text = TxtPassword.Password;
            TxtPassword.Visibility = Visibility.Collapsed;
            TxtPasswordPlain.Visibility = Visibility.Visible;
            BtnTogglePassword.Content = "🙈";
            TxtPasswordPlain.Focus();
            TxtPasswordPlain.CaretIndex = TxtPasswordPlain.Text.Length;
        }
        else
        {
            TxtPassword.Password = TxtPasswordPlain.Text;
            TxtPasswordPlain.Visibility = Visibility.Collapsed;
            TxtPassword.Visibility = Visibility.Visible;
            BtnTogglePassword.Content = "👁️";
            TxtPassword.Focus();
        }
    }

    private void TxtPassword_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (!_isPasswordRevealed && TxtPasswordPlain.Text != TxtPassword.Password)
        {
            TxtPasswordPlain.Text = TxtPassword.Password;
        }
    }

    private void TxtPasswordPlain_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_isPasswordRevealed && TxtPassword.Password != TxtPasswordPlain.Text)
        {
            TxtPassword.Password = TxtPasswordPlain.Text;
        }
    }

    private void TxtPassword_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            SubmitLogin();
        }
    }

    private void TxtPasswordPlain_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            SubmitLogin();
        }
    }

    // -------------------------------------------------------------------------
    // Login Submission & Validation
    // -------------------------------------------------------------------------
    private void BtnLogin_Click(object sender, RoutedEventArgs e)
    {
        SubmitLogin();
    }

    private void SubmitLogin()
    {
        if (!BtnLogin.IsEnabled) return;
        string login = NormalizeLogin(TxtPhone.Text);
        string password = _isPasswordRevealed ? TxtPasswordPlain.Text : TxtPassword.Password;

        if (string.IsNullOrWhiteSpace(login))
        {
            ShowError("Login yoki telefon raqamingizni kiriting.");
            TxtPhone.Focus();
            return;
        }

        if (string.IsNullOrEmpty(password))
        {
            ShowError(_currentLang switch
            {
                "RU" => "Пожалуйста, введите ваш пароль!",
                "EN" => "Please enter your password!",
                _ => "Iltimos, parolingizni kiriting!"
            });
            if (_isPasswordRevealed) TxtPasswordPlain.Focus();
            else TxtPassword.Focus();
            return;
        }

        HideError();
        BtnLogin.IsEnabled = false;
        BtnLogin.Content = _currentLang switch
        {
            "RU" => "Проверка данных...",
            "EN" => "Authenticating...",
            _ => "Tekshirilmoqda..."
        };

        int minutes = int.Parse(((System.Windows.Controls.ComboBoxItem)SessionMinutes.SelectedItem).Tag.ToString()!);
        _loginTimeout?.Stop();
        _loginTimeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        _loginTimeout.Tick += (_, _) => ShowError("Server javob bermadi. Ulanishni tekshiring va qayta urinib ko‘ring.");
        _loginTimeout.Start();
        OnLoginRequested?.Invoke(login, password, minutes);
    }

    // -------------------------------------------------------------------------
    // Error Shake Animation
    // -------------------------------------------------------------------------
    public void ShowError(string message)
    {
        Dispatcher.Invoke(() =>
        {
            _loginTimeout?.Stop();
            TxtError.Text = message;
            BorderError.Visibility = Visibility.Visible;
            BtnLogin.IsEnabled = true;
            BtnLogin.Content = "🚀 KIRISH / SEANS BOSHLASH";

            // Trigger Horizontal Shake Animation on Card
            DoubleAnimationUsingKeyFrames shake = new DoubleAnimationUsingKeyFrames
            {
                Duration = TimeSpan.FromMilliseconds(380)
            };
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromPercent(0.0)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(-16, KeyTime.FromPercent(0.15)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(16, KeyTime.FromPercent(0.30)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(-10, KeyTime.FromPercent(0.50)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(10, KeyTime.FromPercent(0.70)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(-4, KeyTime.FromPercent(0.85)));
            shake.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromPercent(1.0)));

            CardTranslateTransform.BeginAnimation(TranslateTransform.XProperty, shake);
        });
    }

    public void HideError()
    {
        Dispatcher.Invoke(() =>
        {
            BorderError.Visibility = Visibility.Collapsed;
        });
    }

    /// <summary>
    /// SaaS Anti-Piracy & Kill-Switch Enforcer
    /// </summary>
    public void ShowEmergencyLockdown(string reason, string message)
    {
        Dispatcher.Invoke(() =>
        {
            TxtError.Text = string.IsNullOrWhiteSpace(message) 
                ? "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16" 
                : message;
            BorderError.Visibility = Visibility.Visible;
            BtnLogin.IsEnabled = false;
            BtnLogin.Content = "🚫 LITSENZIYA TO'XTATILGAN";
            TxtPhone.IsEnabled = false;
            TxtPassword.IsEnabled = false;
            TxtPasswordPlain.IsEnabled = false;
        });
    }

    private DispatcherTimer? _loginTimeout;
    private DispatcherTimer? _sessionBarNoticeTimer;
    private string? _lastMemberSummary;
    private string? _lastSessionBarNotice;
    public void ShowMemberSessionSummary(MemberSessionSummary summary)
    {
        if (_lastMemberSummary == summary.SessionId) return;
        _lastMemberSummary = summary.SessionId;
        var culture = CultureInfo.GetCultureInfo("uz-UZ");
        string Money(double value) => value.ToString("N0", culture) + " so‘m";
        MemberSessionSummaryText.Text = $"Hisob #{summary.AccountId} · {summary.Username}\nO‘ynalgan vaqt: {summary.PlayedMinutes:N0} daqiqa\nO‘yin xarajati: {Money(summary.GameAmount)}\nHisobga qaytdi: {Money(summary.RefundAmount)}\nQolgan balans: {Money(summary.Balance)}";
        MemberSessionSummaryText.Visibility = Visibility.Visible;
        SessionBarNoticeMessage.Text = summary.BarDebt > 0 ? "Bar to‘lovi kassada qabul qilinadi." : "Hisobingiz saqlandi. Keyingi safar shu login bilan kirishingiz mumkin.";
        SessionBarNoticeAmount.Text = summary.BarDebt > 0 ? Money(summary.BarDebt) : "";
        StartSessionNoticeTimer();
    }
    public void ShowSessionBarNotice(string sessionId, string message, double amount)
    {
        if (_lastSessionBarNotice == sessionId || amount <= 0) return;
        _lastSessionBarNotice = sessionId;
        SessionBarNoticeMessage.Text = message;
        SessionBarNoticeAmount.Text = amount.ToString("N0", CultureInfo.GetCultureInfo("uz-UZ")) + " so‘m";
        StartSessionNoticeTimer();
    }
    private void StartSessionNoticeTimer()
    {
        _sessionBarNoticeTimer?.Stop();
        SessionBarNoticeOverlay.Visibility = Visibility.Visible;
        _sessionBarNoticeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
        _sessionBarNoticeTimer.Tick += (_, _) => HideSessionBarNotice();
        _sessionBarNoticeTimer.Start();
    }
    private void HideSessionBarNotice()
    {
        _sessionBarNoticeTimer?.Stop();
        SessionBarNoticeOverlay.Visibility = Visibility.Collapsed;
        MemberSessionSummaryText.Text = "";
        MemberSessionSummaryText.Visibility = Visibility.Collapsed;
        SessionBarNoticeMessage.Text = "";
        SessionBarNoticeAmount.Text = "";
    }

    public void ResetFields()
    {
        Dispatcher.Invoke(() =>
        {
            HideSessionBarNotice();
            _loginTimeout?.Stop();
            TxtPhone.Clear();
            TxtPassword.Clear();
            TxtPasswordPlain.Clear();
            _isPasswordRevealed = false;
            TxtPassword.Visibility = Visibility.Visible;
            TxtPasswordPlain.Visibility = Visibility.Collapsed;
            TxtPhone.IsEnabled = TxtPassword.IsEnabled = TxtPasswordPlain.IsEnabled = true;
            _adminAccessGranted = false;
            _adminAuthGeneration++;
            AdminModalOverlay.Visibility = Visibility.Collapsed;
            HideError();
            BtnLogin.IsEnabled = true;
            BtnLogin.Content = "🚀 KIRISH / SEANS BOSHLASH";
        });
    }

    // -------------------------------------------------------------------------
    // Smooth Fade-Out Unlock Animation
    // -------------------------------------------------------------------------
    public void UnlockWithFadeOut(Action? onCompleted = null)
    {
        Dispatcher.Invoke(() =>
        {
            _qrCountdownTimer.Stop();

            DoubleAnimation fadeOut = new DoubleAnimation
            {
                From = 1.0,
                To = 0.0,
                Duration = TimeSpan.FromMilliseconds(350),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };

            fadeOut.Completed += (s, e) =>
            {
                ShowWindowsTaskbar();
                Hide();
                RootGrid.Opacity = 1.0; // Reset for next lock
                onCompleted?.Invoke();
            };

            RootGrid.BeginAnimation(UIElement.OpacityProperty, fadeOut);
        });
    }

    // -------------------------------------------------------------------------
    // Language Switcher Engine
    // -------------------------------------------------------------------------
    private void BtnLang_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Content is string lang)
        {
            _currentLang = lang;
            UpdateLanguageUi();
        }
    }

    private void UpdateLanguageUi()
    {
        // Update active tab buttons visual
        BtnLangUz.Foreground = _currentLang == "UZ" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#06B6D4")! : (SolidColorBrush)new BrushConverter().ConvertFrom("#64748B")!;
        BtnLangUz.Background = _currentLang == "UZ" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#1D2436")! : Brushes.Transparent;

        BtnLangRu.Foreground = _currentLang == "RU" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#06B6D4")! : (SolidColorBrush)new BrushConverter().ConvertFrom("#64748B")!;
        BtnLangRu.Background = _currentLang == "RU" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#1D2436")! : Brushes.Transparent;

        BtnLangEn.Foreground = _currentLang == "EN" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#06B6D4")! : (SolidColorBrush)new BrushConverter().ConvertFrom("#64748B")!;
        BtnLangEn.Background = _currentLang == "EN" ? (SolidColorBrush)new BrushConverter().ConvertFrom("#1D2436")! : Brushes.Transparent;

        UpdateClockAndDate();

        switch (_currentLang)
        {
            case "RU":
                TxtAuthHeader.Text = "Вход для клиентов";
                TxtAuthSubHeader.Text = "Играйте свободно используя ваш баланс";
                BtnTabPhone.Content = "📱 По телефону";
                BtnTabQr.Content = "⚡ Быстрый QR";
                LblPhone.Text = "\u041b\u043e\u0433\u0438\u043d / \u0442\u0435\u043b\u0435\u0444\u043e\u043d";
                LblPassword.Text = "Пароль";
                BtnLogin.Content = "🚀 ВОЙТИ / НАЧАТЬ СЕАНС";
                BtnRefreshQr.Content = "🔄 Обновить QR-Код";
                TxtBottomHint.Text = "Для игры в качестве гостя обратитесь к кассиру или войдите в аккаунт.";
                TxtCardHint.Text = "Оплата и возврат отображаются в истории баланса.";
                break;

            case "EN":
                TxtAuthHeader.Text = "Member Sign In";
                TxtAuthSubHeader.Text = "Play seamlessly using your club balance";
                BtnTabPhone.Content = "📱 By Phone";
                BtnTabQr.Content = "⚡ Instant QR";
                LblPhone.Text = "Login or phone number";
                LblPassword.Text = "Password";
                BtnLogin.Content = "🚀 LOGIN / START SESSION";
                BtnRefreshQr.Content = "🔄 Refresh QR Code";
                TxtBottomHint.Text = "To play as a guest, please visit the reception desk or log in.";
                TxtCardHint.Text = "Session payments and refunds appear in your balance history.";
                break;

            default: // UZ
                TxtAuthHeader.Text = "Mijoz Kirishi";
                TxtAuthSubHeader.Text = "Hisobingiz va balansingiz orqali erkin o'ynang";
                BtnTabPhone.Content = "📱 Telefon orqali";
                BtnTabQr.Content = "⚡ Tezkor QR-Kod";
                LblPhone.Text = "Login yoki telefon raqami";
                LblPassword.Text = "Parol";
                BtnLogin.Content = "🚀 KIRISH / SEANS BOSHLASH";
                BtnRefreshQr.Content = "🔄 Yangi QR-Kod olish";
                TxtBottomHint.Text = "Mehmon sifatida o'ynash uchun kassaga murojaat qiling yoki hisobingiz orqali kiring.";
                TxtCardHint.Text = "Seans to‘lovi va qaytimi balans tarixida ko‘rinadi.";
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Admin Maintenance & Settings Modal Logic
    // -------------------------------------------------------------------------
    private int _logoClickCount = 0;
    private DateTime _lastLogoClickTime = DateTime.MinValue;

    private void LogoBrandPanel_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        DateTime now = DateTime.Now;
        if ((now - _lastLogoClickTime).TotalSeconds > 3.0)
        {
            _logoClickCount = 0;
        }

        _lastLogoClickTime = now;
        _logoClickCount++;

        if (_logoClickCount >= 5)
        {
            _logoClickCount = 0;
            OpenAdminMaintenanceModal();
        }
    }

    public void OpenAdminMaintenanceModal()
    {
        Dispatcher.Invoke(() =>
        {
            _adminAccessGranted = false;
            _adminAuthGeneration++;
            AdminModalOverlay.Visibility = Visibility.Visible;
            AdminAuthStepPanel.Visibility = Visibility.Visible;
            AdminDashboardStepPanel.Visibility = Visibility.Collapsed;
            TxtAdminPassword.Password = "";
            TxtAdminAuthError.Visibility = Visibility.Collapsed;
            TxtConfigSaveMsg.Visibility = Visibility.Collapsed;
            TxtAdminPassword.Focus();
        });
    }

    private void BtnCloseAdminModal_Click(object sender, RoutedEventArgs e)
    {
        _adminAccessGranted = false;
        _adminAuthGeneration++;
        AdminModalOverlay.Visibility = Visibility.Collapsed;
        TxtAdminPassword.Password = "";
        TxtAdminAuthError.Visibility = Visibility.Collapsed;
    }

    private void TxtAdminPassword_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            BtnAdminAuthSubmit_Click(sender, e);
        }
    }

    private bool _adminAccessGranted;
    private bool _adminAuthInProgress;
    private int _adminAuthGeneration;
    private readonly EmergencyAccessGuard _emergencyAccess = new();

    private async void BtnAdminAuthSubmit_Click(object sender, RoutedEventArgs e)
    {
        if (_adminAuthInProgress) return;
        _adminAuthInProgress = true;
        _adminAccessGranted = false;
        BtnAdminAuthSubmit.IsEnabled = false;
        TxtAdminAuthError.Visibility = Visibility.Collapsed;
        try
        {
            int generation = _adminAuthGeneration;
            string password = TxtAdminPassword.Password;
            TxtAdminPassword.Password = "";
            string path = System.IO.Path.Combine(AppContext.BaseDirectory, "config.json");
            string? error = await System.Threading.Tasks.Task.Run(() => _emergencyAccess.Authenticate(path, password));
            if (generation != _adminAuthGeneration || AdminModalOverlay.Visibility != Visibility.Visible) return;
            if (error != null) throw new InvalidOperationException(error);
            _adminAccessGranted = true;
            TxtAdminPassword.Password = "";
            AdminAuthStepPanel.Visibility = Visibility.Collapsed;
            AdminDashboardStepPanel.Visibility = Visibility.Visible;
            TxtConfigPcNumber.Text = _currentPcNumber.ToString();
            TxtConfigServerUrl.Text = Softech.Networking.ServerAddress.Display(App.Instance?.WsService?.ServerUrl ?? "");
            TxtConfigSaveMsg.Visibility = Visibility.Collapsed;
        }
        catch (Exception error)
        {
            TxtAdminAuthError.Text = error is InvalidOperationException ? error.Message : "Parolni tekshirishda xatolik. Qayta urinib ko'ring.";
            TxtAdminAuthError.Visibility = Visibility.Visible;
        }
        finally
        {
            _adminAuthInProgress = false;
            BtnAdminAuthSubmit.IsEnabled = true;
        }
    }

    private void BtnAdminUnlockMaintenance_Click(object sender, RoutedEventArgs e)
    {
        if (!_adminAccessGranted) return;
        AdminModalOverlay.Visibility = Visibility.Collapsed;
        App.Instance?.EnableMaintenanceMode();
    }

    private void BtnAdminExitClient_Click(object sender, RoutedEventArgs e)
    {
        if (!_adminAccessGranted) return;
        if (System.Windows.MessageBox.Show("Rostdan ham NetCafe Kiosk dasturini butunlay yopmoqchimisiz?", 
            "Admin Chiqish", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
        {
            App.Instance?.AdminGracefulExit();
        }
    }

    private void BtnSaveConfig_Click(object sender, RoutedEventArgs e)
    {
        if (!_adminAccessGranted) return;
        if (int.TryParse(TxtConfigPcNumber.Text.Trim(), out int pcNum) && pcNum > 0)
        {
            string url = TxtConfigServerUrl.Text.Trim();
            if (!string.IsNullOrEmpty(url))
            {
                try
                {
                    App.Instance?.SaveConfiguration(pcNum, url);
                    TxtConfigSaveMsg.Visibility = Visibility.Visible;
                }
                catch (ArgumentException ex)
                {
                    System.Windows.MessageBox.Show(ex.Message, "Server manzilini tekshiring", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }
    }
}
