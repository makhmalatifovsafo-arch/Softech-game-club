using System;
using Color = System.Windows.Media.Color;
using Brushes = System.Windows.Media.Brushes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
namespace NetCafeClient.Views;
public sealed class AdminMessageWindow : Window
{
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(30) };
    public AdminMessageWindow(string title, string message)
    {
        Title = "Softech"; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        Topmost = true; ShowInTaskbar = false; ShowActivated = false;
        Width = Math.Min(520, SystemParameters.WorkArea.Width - 24);
        MaxHeight = SystemParameters.WorkArea.Height - 40;
        SizeToContent = SizeToContent.Height; WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(24,24,32));
        var panel = new StackPanel { Margin = new Thickness(24) };
        panel.Children.Add(new TextBlock {Text=title, FontSize=22, FontWeight=FontWeights.Bold, Foreground=Brushes.White, TextWrapping=TextWrapping.Wrap});
        panel.Children.Add(new ScrollViewer {MaxHeight=Math.Max(100,SystemParameters.WorkArea.Height-200), VerticalScrollBarVisibility=ScrollBarVisibility.Auto,
            Content=new TextBlock {Text=message, FontSize=18, Foreground=Brushes.White, TextWrapping=TextWrapping.Wrap, Margin=new Thickness(0,16,0,16)}});
        var close = new System.Windows.Controls.Button {Content="Tushunarli", Padding=new Thickness(16,8,16,8)};
        close.Click += (_,_) => Close(); panel.Children.Add(close); Content=panel;
        timer.Tick += (_,_) => Close(); Closed += (_,_) => timer.Stop(); Loaded += (_,_) => timer.Start();
    }
}
