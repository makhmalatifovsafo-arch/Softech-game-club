using System;
using System.Windows;
using System.Windows.Forms;

namespace NetCafeClient.Views;

public partial class MaintenanceToolbarWindow : Window
{
    public event Action? OnRelockRequested;
    public event Action? OnSettingsRequested;
    public event Action? OnExitRequested;

    public MaintenanceToolbarWindow()
    {
        InitializeComponent();
        Loaded += MaintenanceToolbarWindow_Loaded;
    }

    private void MaintenanceToolbarWindow_Loaded(object sender, RoutedEventArgs e)
    {
        // Position at top-right of primary screen
        var primary = Screen.PrimaryScreen?.WorkingArea ?? new System.Drawing.Rectangle(0, 0, 1920, 1080);
        Left = primary.Right - ActualWidth - 24;
        Top = primary.Top + 16;
    }

    public void SetPcInfo(int pcNumber)
    {
        TxtPcStatus.Text = $"PC-{pcNumber:D2} | Qulf vaqtinchalik ochiq";
    }

    private void BtnRelock_Click(object sender, RoutedEventArgs e)
    {
        Hide();
        OnRelockRequested?.Invoke();
    }

    private void BtnSettings_Click(object sender, RoutedEventArgs e)
    {
        OnSettingsRequested?.Invoke();
    }

    private void BtnExit_Click(object sender, RoutedEventArgs e)
    {
        OnExitRequested?.Invoke();
    }
}
