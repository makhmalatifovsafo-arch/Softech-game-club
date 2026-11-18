// Render the real brand fragments with resources loaded from the built binaries.
// No app constructors, windows, kiosk hooks, services or network calls are run.
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml.Linq;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var app = new Application();
        var root = Directory.GetCurrentDirectory();
        foreach (var (assemblyPath, xamlPath, elementName, name) in new[] {
            ("NetCafeClient/bin/Release/net8.0-windows/NetCafeClient.dll", "NetCafeClient/LockWindow.xaml", "LogoBrandPanel", "client"),
            ("NetCafeServer/Launcher/bin/Release/net8.0-windows/win-x64/SoftechCockpit.dll", "NetCafeServer/Launcher/MainWindow.xaml", "LoadingOverlay", "server")
        })
        {
            var assembly = Assembly.LoadFrom(Path.Combine(root, assemblyPath));
            var uri = new Uri($"/{assembly.GetName().Name};component/Branding/Brand.xaml", UriKind.Relative);
            app.Resources = (ResourceDictionary)Application.LoadComponent(uri);
            var font = (FontFamily)app.Resources["SoftechWordmarkFont"];
            if (!new Typeface(font, FontStyles.Normal, FontWeights.ExtraBold, FontStretches.Normal).TryGetGlyphTypeface(out var face) ||
                !face.FamilyNames.Values.Contains("Manrope") || face.Weight != FontWeights.ExtraBold)
                throw new Exception($"{name}: bundled Manrope font did not resolve; fallback fonts are unacceptable.");
            if (app.Resources["SoftechMark"] is not DrawingImage) throw new Exception("Logo is not a vector");

            XNamespace x = "http://schemas.microsoft.com/winfx/2006/xaml";
            var fragment = XDocument.Load(xamlPath).Descendants().Single(el => (string?)el.Attribute(x + "Name") == elementName);
            if (name == "server") fragment = fragment.Elements().Single();
            fragment.SetAttributeValue(XNamespace.Xmlns + "x", x.NamespaceName);
            foreach (var attr in fragment.DescendantsAndSelf().Attributes().Where(a =>
                a.Name.LocalName is "MouseLeftButtonDown" or "Name" or "Cursor").ToArray()) attr.Remove();
            foreach (var scale in new[] { 1.0, 1.5, 2.0 })
            {
                var content = (FrameworkElement)XamlReader.Parse(fragment.ToString());
                var canvas = new Border { Width = 430, Height = name == "server" ? 300 : 100,
                    Background = new SolidColorBrush(Color.FromRgb(9, 10, 12)), Padding = new Thickness(24),
                    Child = content, UseLayoutRounding = true, SnapsToDevicePixels = true };
                canvas.Measure(new Size(canvas.Width, canvas.Height));
                canvas.Arrange(new Rect(0, 0, canvas.Width, canvas.Height)); canvas.UpdateLayout();
                var bitmap = new RenderTargetBitmap((int)(canvas.Width * scale), (int)(canvas.Height * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
                bitmap.Render(canvas);
                var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
                Directory.CreateDirectory(".test-output");
                using var file = File.Create($".test-output/brand-{name}-{scale * 100:0}.png"); encoder.Save(file);
            }
            Console.WriteLine($"PASS {name}: embedded vector + Manrope ExtraBold, actual XAML rendered at 100%, 150%, 200%");
        }
        app.Shutdown();
    }
}
