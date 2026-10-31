using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using NetCafeClient.Views;
using NetCafeClient;

// Render without Show/Loaded or the production App startup: no kiosk hooks or game scan.
class UiLayoutSmoke
{
    [STAThread]
    static void Main()
    {
        try
        {
            var app = new Application();
            foreach (var width in new[] { 1024, 1366, 1920 })
            {
                var shell = new ShellWindow();
                typeof(ShellWindow).GetMethod("UpdateAdaptiveLayout", BindingFlags.NonPublic | BindingFlags.Instance)!
                    .Invoke(shell, new object[] { (double)width });
                Render(shell, width, 768, "shell-" + width);
                shell.Close();
            }
            var login = new LockWindow { IsAllowClosing = true };
            Render(login, 1366, 768, "login-1366");
            login.Close();
            var bar = new BarShopWindow();
            Render(bar, 1000, 650, "bar-1000");
            bar.Close();
            app.Shutdown();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Environment.Exit(1);
        }
    }

    static void Render(Window window, int width, int height, string name)
    {
        var content = (FrameworkElement)window.Content;
        content.Measure(new Size(width, height));
        content.Arrange(new Rect(0, 0, width, height));
        content.UpdateLayout();
        if (!double.IsFinite(content.DesiredSize.Width) || !double.IsFinite(content.DesiredSize.Height))
            throw new Exception("Layout must be finite");
        Directory.CreateDirectory(".test-output");
        var image = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        image.Render(content);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(image));
        using var file = File.Create(".test-output/" + name + ".png");
        encoder.Save(file);
        Console.WriteLine(name + " rendered " + content.RenderSize);
    }
}
