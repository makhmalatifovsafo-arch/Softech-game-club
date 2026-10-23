using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace NetCafeClient;

public partial class TimeWidgetWindow : Window
{
    private int _remainingSeconds = 0;
    private readonly DispatcherTimer _timer;

    public event Action? OnLogoutRequested;

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
            _remainingSeconds = remainingSeconds;
            TxtPc.Text = $"PC #{pcNumber}";
            TxtMemberName.Text = $"👤 {username}";
            TxtBalance.Text = $"💳 {balance:N0} UZS";
            TxtBalance.Visibility = Visibility.Visible;
            TxtTariff.Text = "Mijoz Balansi";
            BtnLogout.Visibility = Visibility.Visible;

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
            _remainingSeconds = remainingSeconds;
            TxtPc.Text = $"PC #{pcNumber}";
            TxtMemberName.Text = $"👤 {customerName}";
            TxtBalance.Visibility = Visibility.Collapsed;
            TxtTariff.Text = tariffName;
            BtnLogout.Visibility = Visibility.Visible;

            UpdateDisplay();
            _timer.Start();
            Show();
        });
    }

    public void UpdateTime(int remainingSeconds)
    {
        Dispatcher.Invoke(() =>
        {
            _remainingSeconds = remainingSeconds;
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
            Hide();
        });
    }

    private void Timer_Tick(object? sender, EventArgs e)
    {
        if (_remainingSeconds > 0)
        {
            _remainingSeconds--;
            UpdateDisplay();
        }
    }

    private void UpdateDisplay()
    {
        var ts = TimeSpan.FromSeconds(_remainingSeconds);
        TxtRemainingTime.Text = $"{(int)ts.TotalHours:D2}:{ts.Minutes:D2}:{ts.Seconds:D2}";

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
