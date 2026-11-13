using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace NetCafeClient;

public partial class TimeWidgetWindow : Window
{
    private int _remainingSeconds = 0;
    private readonly DispatcherTimer _timer;
    private long? _expiresAtTimestamp;
    private bool _canSelfClose;
    private SessionInfo? _sessionInfo;
    private long _infoTimestamp;
    private bool _serverConnected = true;

    public Func<string, string?, string, System.Threading.Tasks.Task<System.Text.Json.JsonElement>>? UpdateAccount;
    private string _memberUsername = "";
    private Views.AccountSettingsWindow? _accountWindow;
    private void BtnAccount_Click(object sender, RoutedEventArgs e)
    {
        if (!_canSelfClose || UpdateAccount == null) return;
        if (_accountWindow != null) { _accountWindow.Activate(); return; }
        var dialog = new Views.AccountSettingsWindow(_memberUsername, UpdateAccount);
        _accountWindow = dialog;
        dialog.Owner = this;
        dialog.Saved += username => {
            if (!ReferenceEquals(_accountWindow, dialog) || !_canSelfClose) return;
            _memberUsername = username; TxtMemberName.Text = username;
        };
        dialog.Closed += (_, _) => { if (ReferenceEquals(_accountWindow, dialog)) _accountWindow = null; };
        dialog.Show();
    }
    public event Action? OnLogoutRequested;
    public event Action? OnSessionExpired;

    public void SetLogoutPending(bool pending)
    {
        BtnLogout.IsEnabled = !pending;
        BtnLogout.Content = pending ? "Yopilmoqda..." : "Seansni yakunlash";
    }

    private void SetRemainingTime(int seconds)
    {
        _remainingSeconds = seconds;
        _expiresAtTimestamp = seconds < 0 ? null : Stopwatch.GetTimestamp() + (long)seconds * Stopwatch.Frequency;
        BtnLogout.Visibility = _canSelfClose && seconds >= 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    public TimeWidgetWindow()
    {
        InitializeComponent();

        // Ekranning yuqori o'ng burchagiga joylashtirish
        Loaded += (s, e) =>
        {
            var desktopWorkingArea = SystemParameters.WorkArea;
            Left = desktopWorkingArea.Right - Width - 20;
            Top = desktopWorkingArea.Top + 20;
        };

        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += Timer_Tick;
    }

    /// <summary>
    /// Shaxsiy mijoz akkaunti orqali seansni boshlash
    /// </summary>
    public void StartMemberSession(string username, double balance, int remainingSeconds, int pcNumber)
    {
        Dispatcher.Invoke(() =>
        {
            _canSelfClose = true;
            _memberUsername = username;
            BtnAccount.Visibility = Visibility.Visible;
            _sessionInfo = null;
            TxtSessionInterval.Text = "";
            TxtBillingStatus.Text = "";
            SetRemainingTime(remainingSeconds);
            TxtPc.Text = $"PC #{pcNumber}";
            TxtMemberName.Text = $"👤 {username}";
            TxtBalance.Text = $"💳 {balance:N0} UZS";
            TxtBalance.Visibility = Visibility.Visible;
            TxtTariff.Text = "Mijoz Balansi";

            UpdateDisplay();
            _timer.Start();
            Show();
        });
    }

    /// <summary>
    /// Kassir tomonidan ochilgan standart mehmon seansini boshlash
    /// </summary>
    public void StartStandardSession(int remainingSeconds, string tariffName, int pcNumber, string customerName = "Mehmon")
    {
        Dispatcher.Invoke(() =>
        {
            _canSelfClose = false;
            BtnAccount.Visibility = Visibility.Collapsed;
            _accountWindow?.Close();
            _sessionInfo = null;
            TxtSessionInterval.Text = "";
            TxtBillingStatus.Text = "Seansni kassir yakunlaydi.";
            SetRemainingTime(remainingSeconds);
            TxtPc.Text = $"PC #{pcNumber}";
            TxtMemberName.Text = $"👤 {customerName}";
            TxtBalance.Visibility = Visibility.Collapsed;
            TxtTariff.Text = "Hisob ma’lumoti kutilmoqda…";

            UpdateDisplay();
            _timer.Start();
            Show();
        });
    }

    public void UpdateTime(int remainingSeconds)
    {
        Dispatcher.Invoke(() =>
        {
            SetRemainingTime(remainingSeconds);
            UpdateDisplay();
        });
    }

    public void UpdateBalance(double balance)
    {
        Dispatcher.Invoke(() =>
        {
            TxtBalance.Text = $"💳 {balance:N0} UZS";
        });
    }

    public void StopSession()
    {
        Dispatcher.Invoke(() =>
        {
            _timer.Stop();
            _expiresAtTimestamp = null;
            _sessionInfo = null;
            _canSelfClose = false;
            BtnAccount.Visibility = Visibility.Collapsed;
            _accountWindow?.Close();
            BtnLogout.Visibility = Visibility.Collapsed;
            Hide();
        });
    }

    private void Timer_Tick(object? sender, EventArgs e)
    {
        if (_expiresAtTimestamp is long deadline)
        {
            _remainingSeconds = (int)Math.Max(0, Math.Ceiling((deadline - Stopwatch.GetTimestamp()) / (double)Stopwatch.Frequency));
            UpdateDisplay();
            if (_remainingSeconds == 0)
            {
                _expiresAtTimestamp = null;
                _timer.Stop();
                OnSessionExpired?.Invoke();
            }
        }
        else UpdateDisplay();
    }

    public void UpdateSessionInfo(SessionInfo info)
    {
        Dispatcher.Invoke(() =>
        {
            _sessionInfo = info;
            _infoTimestamp = Stopwatch.GetTimestamp();
            _canSelfClose = info.CanSelfClose && !info.IsPostpaid;
            BtnAccount.Visibility = _canSelfClose ? Visibility.Visible : Visibility.Collapsed;
            if (!_canSelfClose) _accountWindow?.Close();
            BtnLogout.Visibility = _canSelfClose ? Visibility.Visible : Visibility.Collapsed;
            UpdateDisplay();
        });
    }

    public void SetServerConnected(bool connected)
    {
        Dispatcher.Invoke(() => { _serverConnected = connected; UpdateDisplay(); });
    }

    private void UpdateDisplay()
    {
        var elapsed = _sessionInfo == null ? 0 : Math.Max(0,(_sessionInfo.AsOf - _sessionInfo.StartedAt)/1000.0 +
            (Stopwatch.GetTimestamp()-_infoTimestamp)/(double)Stopwatch.Frequency);
        var ts = TimeSpan.FromSeconds(_remainingSeconds < 0 ? elapsed : _remainingSeconds);
        TxtTimeLabel.Text = _remainingSeconds < 0 ? "O‘tgan vaqt: " : "Qolgan vaqt: ";
        TxtRemainingTime.Text = _remainingSeconds < 0 && _sessionInfo == null ? "Ochiq seans" : $"{(int)ts.TotalHours:D2}:{ts.Minutes:D2}:{ts.Seconds:D2}";
        if (_sessionInfo is { } info)
        {
            var start = DateTimeOffset.FromUnixTimeMilliseconds(info.StartedAt).ToLocalTime();
            var until = start.AddSeconds(elapsed);
            TxtSessionInterval.Text = $"{start:HH:mm:ss} — {until:HH:mm:ss}";
            if (!_canSelfClose)
            {
                TxtTariff.Text = info.GameAmount is double amount
                    ? $"{(info.IsPostpaid ? "O‘yin hisobi" : "Seans narxi")}: {amount:N0} UZS"
                    : "Hisob aniqlanmadi";
                TxtTariff.Foreground = System.Windows.Media.Brushes.LightGreen;
                TxtBillingStatus.Text = info.BillingError ?? (info.IsPostpaid
                    ? $"Hisob: {DateTimeOffset.FromUnixTimeMilliseconds(info.AsOf).ToLocalTime():HH:mm:ss} da · Kassir yakunlaydi"
                    : "Seansni kassir yakunlaydi.");
                if (!_serverConnected) TxtBillingStatus.Text += " · Server bilan aloqa uzilgan";
            }
        }

        // Agar 5 daqiqadan kam qolsa, qizil/ogohlantiruvchi rang
        if (_remainingSeconds >= 0 && _remainingSeconds < 300)
        {
            TxtRemainingTime.Foreground = System.Windows.Media.Brushes.Tomato;
        }
        else
        {
            TxtRemainingTime.Foreground = System.Windows.Media.Brushes.White;
        }
    }

    private void BtnLogout_Click(object sender, RoutedEventArgs e)
    {
        if (!_canSelfClose || _remainingSeconds < 0) return;
        var result = System.Windows.MessageBox.Show(
            "Haqiqatan ham seansni tugatib tizimdan chiqmoqchimisiz?\n\nQolgan mablag'ingiz hisobingizda xavfsiz saqlanadi.",
            "Seansni Tugatish",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (result == MessageBoxResult.Yes)
        {
            OnLogoutRequested?.Invoke();
        }
    }

    // Foydalanuvchi vidjetni ekranda xohlagan joyiga surib qo'yishi mumkin (Drag and Drop)
    private void Window_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
    }
}
