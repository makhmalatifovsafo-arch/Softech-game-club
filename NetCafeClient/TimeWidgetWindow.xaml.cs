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
        BtnLogout.Visibility = seconds < 0 ? Visibility.Collapsed : Visibility.Visible;
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
            SetRemainingTime(remainingSeconds);
            TxtPc.Text = $"PC #{pcNumber}";
            TxtMemberName.Text = $"👤 {customerName}";
            TxtBalance.Visibility = Visibility.Collapsed;
            TxtTariff.Text = tariffName;

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
    }

    private void UpdateDisplay()
    {
        var ts = TimeSpan.FromSeconds(_remainingSeconds);
        TxtRemainingTime.Text = _remainingSeconds < 0 ? "Ochiq seans" : $"{(int)ts.TotalHours:D2}:{ts.Minutes:D2}:{ts.Seconds:D2}";

        // Agar 5 daqiqadan kam qolsa, qizil/ogohlantiruvchi rang
        if (_remainingSeconds < 300)
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
