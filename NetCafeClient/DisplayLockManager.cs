using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Forms;
using System.Windows.Interop;
using Microsoft.Win32;

namespace NetCafeClient;

/// <summary>
/// DisplayLockManager — Ko'p monitorda qulfni boshqarish.
/// Birlamchi ekranda LockWindow, qolgan ekranlarda qora to'siq (BlackoutWindow) ko'rsatiladi.
/// DisplaySettingsChanged hodisasiga obuna bo'lib, monitor o'zgarganda qayta sozlanadi.
/// </summary>
public class DisplayLockManager : IDisposable
{
    // ---- Win32: SetWindowPos ----
    private const int  SWP_NOMOVE       = 0x0002;
    private const int  SWP_NOSIZE       = 0x0001;
    private const int  SWP_SHOWWINDOW   = 0x0040;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    // ---- Fields ----
    private readonly LockWindow                _lockWindow;
    private readonly List<BlackoutWindow>      _blackouts = new();
    private          bool                      _isLocked  = false;
    private          bool                      _disposed  = false;

    public DisplayLockManager(LockWindow lockWindow)
    {
        _lockWindow = lockWindow;

        // Monitor o'zgarganda qulfni qayta sozlash
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// <summary>Barcha ekranlarda qulf oynalarini ko'rsatish</summary>
    public void ShowLock()
    {
        _isLocked = true;
        LockWindow.HideWindowsTaskbar();
        RefreshDisplays();
    }

    /// <summary>Barcha ekranlarda qulf oynalarini yashirish</summary>
    public void HideLock(Action? onCompleted = null)
    {
        _isLocked = false;

        _lockWindow.Dispatcher.Invoke(() =>
        {
            _lockWindow.UnlockWithFadeOut(() =>
            {
                foreach (var bo in _blackouts)
                {
                    try { bo.Hide(); } catch { /* ignore */ }
                }
                onCompleted?.Invoke();
            });
        });
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        if (_isLocked)
        {
            // Kichik gecikmadan keyin (driver sozlanguncha) ekranlarni yangilash
            System.Threading.Thread.Sleep(500);
            _lockWindow.Dispatcher.Invoke(RefreshDisplays);
        }
    }

    private void RefreshDisplays()
    {
        // Eski qora to'siqlarni tozalash
        foreach (var bo in _blackouts)
        {
            try { bo.Close(); } catch { /* ignore */ }
        }
        _blackouts.Clear();

        var screens = Screen.AllScreens;

        // Birlamchi ekran — LockWindow
        var primary = Screen.PrimaryScreen;
        if (primary != null)
        {
            SetupLockWindowOnScreen(primary);
        }

        // Qolgan ekranlar — qora to'siq
        foreach (var screen in screens)
        {
            if (screen.Primary) continue;
            var blackout = new BlackoutWindow(screen);
            _blackouts.Add(blackout);
            blackout.Show();
        }
    }

    private void SetupLockWindowOnScreen(Screen screen)
    {
        _lockWindow.Dispatcher.Invoke(() =>
        {
            _lockWindow.WindowState = WindowState.Normal;
            _lockWindow.Left        = screen.Bounds.Left   / GetDpiScale();
            _lockWindow.Top         = screen.Bounds.Top    / GetDpiScale();
            _lockWindow.Width       = screen.Bounds.Width  / GetDpiScale();
            _lockWindow.Height      = screen.Bounds.Height / GetDpiScale();
            _lockWindow.WindowState = WindowState.Maximized;
            _lockWindow.Topmost     = true;
            _lockWindow.Show();
            _lockWindow.Activate();
            _lockWindow.Focus();

            // Win32 orqali ham TOPMOST sifatida qo'yish
            try
            {
                var hwnd = new WindowInteropHelper(_lockWindow).Handle;
                if (hwnd != IntPtr.Zero)
                    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            }
            catch { /* ignore */ }
        });
    }

    private static double GetDpiScale()
    {
        try
        {
            // DPI miqyosini olish (default 96 DPI = 1.0)
            using var g = System.Drawing.Graphics.FromHwnd(IntPtr.Zero);
            return g.DpiX / 96.0;
        }
        catch { return 1.0; }
    }

    // -----------------------------------------------------------------------
    // IDisposable
    // -----------------------------------------------------------------------

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        foreach (var bo in _blackouts)
        {
            try { bo.Close(); } catch { /* ignore */ }
        }
        _blackouts.Clear();
    }
}

// ============================================================
// BlackoutWindow — Ikkinchi ekrandagi qora to'siq oynasi
// ============================================================
public class BlackoutWindow : Window
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    private const int  SWP_SHOWWINDOW = 0x0040;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    public BlackoutWindow(Screen screen)
    {
        WindowStyle      = WindowStyle.None;
        ResizeMode       = ResizeMode.NoResize;
        ShowInTaskbar    = false;
        AllowsTransparency = false;
        Background       = System.Windows.Media.Brushes.Black;
        Topmost          = true;
        Focusable        = false;
        IsHitTestVisible = false;

        // Ekran koordinatlarini DPI hisobga olib o'rnatish
        double dpi = GetDpiScale();
        Left   = screen.Bounds.Left   / dpi;
        Top    = screen.Bounds.Top    / dpi;
        Width  = screen.Bounds.Width  / dpi;
        Height = screen.Bounds.Height / dpi;

        Loaded += (s, e) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd != IntPtr.Zero)
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, 0x0002 | 0x0001 | SWP_SHOWWINDOW);
        };
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        // Yopish ruxsat etilgan (HideLock() dan chaqiriladi)
        base.OnClosing(e);
    }

    private static double GetDpiScale()
    {
        try
        {
            using var g = System.Drawing.Graphics.FromHwnd(IntPtr.Zero);
            return g.DpiX / 96.0;
        }
        catch { return 1.0; }
    }
}
