using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;

namespace SoftechCockpit;

/// <summary>
/// Interaction logic for App.xaml
/// Implements Single-Instance Mutex Guard to prevent duplicate instances.
/// </summary>
public partial class App : Application
{
    private const string MutexName = @"Global\SoftechCockpit_SingleInstance_Mutex_2026";
    private Mutex? _mutex;
    private bool _hasHandle;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern IntPtr FindWindow(string? lpClassName, string lpWindowName);

    private const int SW_RESTORE = 9;

    protected override void OnStartup(StartupEventArgs e)
    {
        try
        {
            _mutex = new Mutex(true, MutexName, out _hasHandle);
        }
        catch (AbandonedMutexException)
        {
            _hasHandle = true;
        }

        if (!_hasHandle)
        {
            // Dastur allaqachon ishlab turibdi: Mavjud oynani oldinga chiqarish (Focus)
            BringExistingInstanceToFront();

            // Yangi instansiyani zudlik bilan yopish
            Shutdown();
            return;
        }

        base.OnStartup(e);
    }

    private static void BringExistingInstanceToFront()
    {
        try
        {
            // 1. Sarlavha orqali topish
            var hWnd = FindWindow(null, "Softech Game Club — Boshqaruv Markazi");

            if (hWnd == IntPtr.Zero)
            {
                // 2. Jarayon nomi orqali qidirish
                var current = Process.GetCurrentProcess();
                var processes = Process.GetProcessesByName(current.ProcessName);

                foreach (var proc in processes)
                {
                    if (proc.Id != current.Id && proc.MainWindowHandle != IntPtr.Zero)
                    {
                        hWnd = proc.MainWindowHandle;
                        break;
                    }
                }
            }

            if (hWnd != IntPtr.Zero)
            {
                ShowWindow(hWnd, SW_RESTORE);
                SetForegroundWindow(hWnd);
            }
        }
        catch
        {
            // Agar Win32 API xatosi bo'lsa, jimgina o'tkazib yuboramiz
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_hasHandle && _mutex != null)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch { }
            finally
            {
                _mutex.Dispose();
                _mutex = null;
            }
        }

        base.OnExit(e);
    }
}
