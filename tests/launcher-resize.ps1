# Run with Windows PowerShell -STA. Load the real window layout without its
# code-behind: never starts Node, contacts a club or opens the installed app.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml
Add-Type -ReferencedAssemblies @('PresentationFramework', 'PresentationCore', 'WindowsBase', 'System.Xaml') -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Interop;
namespace ResizeFixture {
    public class NativeViewport : HwndHost {
        [DllImport("user32.dll", CharSet=CharSet.Unicode)]
        static extern IntPtr CreateWindowEx(int ex, string name, string title, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
        [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
        protected override HandleRef BuildWindowCore(HandleRef parent) {
            var hwnd=CreateWindowEx(0,"STATIC","Isolated native viewport",0x50000000,0,0,1,1,parent.Handle,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
            if(hwnd==IntPtr.Zero) throw new Exception("Cannot create fixture viewport");
            return new HandleRef(this,hwnd);
        }
        protected override void DestroyWindowCore(HandleRef hwnd) { DestroyWindow(hwnd.Handle); }
    }
    public static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
        [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
        [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
        [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr hwnd,Point point,uint flags);
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd,int msg,IntPtr w,IntPtr l);
        public static int Hit(IntPtr hwnd,int x,int y) {
            var point=new Point(x,y);ClientToScreen(hwnd,ref point);
            return (int)SendMessage(hwnd,0x84,IntPtr.Zero,new IntPtr(unchecked((int)(((uint)(ushort)point.Y<<16)|(ushort)point.X))));
        }
    }
}
'@
[xml]$xml = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '../NetCafeServer/Launcher/MainWindow.xaml')
$windowNode = $xml.DocumentElement
$windowNode.RemoveAttribute('Class','http://schemas.microsoft.com/winfx/2006/xaml')
$windowNode.RemoveAttribute('Ignorable','http://schemas.openxmlformats.org/markup-compatibility/2006')
$windowNode.RemoveAttribute('Icon')
foreach ($element in $xml.SelectNodes('//*')) {
    foreach ($attribute in @($element.Attributes)) {
        if ($attribute.LocalName -in @('Click','MouseLeftButtonDown') -or $attribute.Value -like '*x:Static updates:*' -or $attribute.Value -eq 'app.ico') {
            [void]$element.RemoveAttributeNode($attribute)
        }
    }
}
$assemblyName = [ResizeFixture.NativeViewport].Assembly.GetName().Name
$viewport = $xml.SelectSingleNode('//*[local-name()="WebView2"]')
$replacement = $xml.CreateElement('test','NativeViewport',"clr-namespace:ResizeFixture;assembly=$assemblyName")
[void]$viewport.ParentNode.ReplaceChild($replacement,$viewport)
$reader = New-Object System.Xml.XmlNodeReader $xml
$window = [System.Windows.Markup.XamlReader]::Load($reader)
try {
    # Transparent/off-screen fixture, no visible interactive window.
    $window.Opacity=0; $window.ShowInTaskbar=$false; $window.ShowActivated=$false
    $window.WindowStartupLocation='Manual'; $window.Left=-16000; $window.Top=-16000
    $window.Show(); $window.UpdateLayout()
    $window.Dispatcher.Invoke([Action]{},[System.Windows.Threading.DispatcherPriority]::ApplicationIdle)
    $hwnd=(New-Object System.Windows.Interop.WindowInteropHelper $window).Handle
    $rect=New-Object ResizeFixture.Native+Rect
    [void][ResizeFixture.Native]::GetWindowRect($hwnd,[ref]$rect)
    $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
    foreach ($probe in @(@(1,[int]($height/2),10),@(($width-2),[int]($height/2),11),@([int]($width/2),($height-2),15),@(1,($height-2),16),@(($width-2),($height-2),17))) {
        $point=New-Object ResizeFixture.Native+Point($probe[0],$probe[1])
        if ([ResizeFixture.Native]::ChildWindowFromPointEx($hwnd,$point,0) -ne $hwnd) { throw "Native viewport covers resize edge $probe" }
        $hit=[ResizeFixture.Native]::Hit($hwnd,$probe[0],$probe[1])
        if ($hit -ne $probe[2]) { throw "Resize edge $probe returned hit $hit" }
    }
    # The fixture really has a native child; otherwise the edge test is vacuous.
    $middle=New-Object ResizeFixture.Native+Point([int]($width/2),[int]($height/2))
    if ([ResizeFixture.Native]::ChildWindowFromPointEx($hwnd,$middle,0) -eq $hwnd) { throw 'Native viewport fixture is missing' }
    $window.WindowState='Maximized';$window.UpdateLayout()
    $window.Dispatcher.Invoke([Action]{},[System.Windows.Threading.DispatcherPriority]::ApplicationIdle)
    if ($window.FindName('ResizeFrame').BorderThickness.Left -ne 0) { throw 'Maximized window retains an unnecessary resize gutter' }
    $window.WindowState='Normal';$window.UpdateLayout()
    if ($window.FindName('ResizeFrame').BorderThickness.Left -ne 6) { throw 'Restore did not restore resize gutter' }
    Write-Output 'PASS actual launcher XAML with a native child: sides, bottom, corners, maximize and restore'
} finally { $window.Close(); $reader.Close() }
