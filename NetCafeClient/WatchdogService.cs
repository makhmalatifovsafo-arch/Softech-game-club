using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace NetCafeClient;

/// <summary>
/// WatchdogService — "Temir Qulf" O'z-o'zini Tiklash Mexanizmi.
///
/// Dastur kutilmaganda yopilsa (kill, crash), bir zumda qayta ishga tushiradi.
/// Mexanizm: Yangi jarayon o'z PID'ini argument sifatida berib ishga tushiriladi.
/// Agar NetCafeClient.exe yangi argument bilan ishga tushirilsa, eski PIDni kuzatadi.
/// Admin to'g'ri chiqish qilganda (RequestGracefulShutdown), watchdog qayta ochmasdan yopiladi.
/// </summary>
public static class WatchdogService
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    private const uint PROCESS_SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0       = 0x00000000;
    private const uint WAIT_TIMEOUT        = 0x00000102;
    private const uint INFINITE            = 0xFFFFFFFF;

    private static readonly string GracefulExitMarker = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".graceful_exit");

    private static Thread? _watchThread;

    /// <summary>
    /// Admin tomonidan ruxsat berilgan toza chiqishni bildirish.
    /// Watchdog buni ko'rib, qayta ishga tushirmay o'zi ham yopiladi.
    /// </summary>
    public static void RequestGracefulShutdown()
    {
        try
        {
            File.WriteAllText(GracefulExitMarker, DateTime.UtcNow.ToString("o"));
        }
        catch { /* ignore */ }
    }

    /// <summary>
    /// Dastur ishga tushganda chaqirilsin.
    /// args: komanda qatori argumentlari.
    /// </summary>
    public static void Initialize(string[] args)
    {
        // 0. Agar Dev rejim bo'lsa yoki eski graceful marker qolgan bo'lsa
        try
        {
            if (File.Exists(GracefulExitMarker))
            {
                File.Delete(GracefulExitMarker);
            }
        }
        catch {}

        if (App.IsDevMode)
        {
            // Dev rejimda watchdog umuman ishlamasin
            return;
        }

        // 1. Agar bu watchdog instance'i bo'lsa — eski PIDni kuzat
        foreach (string arg in args)
        {
            if (arg.StartsWith("--watchdog-parent="))
            {
                string pidStr = arg.Replace("--watchdog-parent=", "");
                if (int.TryParse(pidStr, out int parentPid))
                {
                    StartWatchingPid(parentPid);
                    return;
                }
            }
        }

        // 2. Normal ishga tushish — o'zimizni kuzatuvchi watchdog instance'ni spawning qilish
        SpawnWatchdogInstance();
    }

    // -----------------------------------------------------------------------
    // Watchdog Instance Spawning
    // -----------------------------------------------------------------------

    private static void SpawnWatchdogInstance()
    {
        try
        {
            string exePath  = Process.GetCurrentProcess().MainModule?.FileName
                              ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "NetCafeClient.exe");
            int    myPid    = Process.GetCurrentProcess().Id;

            var psi = new ProcessStartInfo
            {
                FileName               = exePath,
                Arguments              = $"--watchdog-parent={myPid}",
                UseShellExecute        = false,
                CreateNoWindow         = true,
                WorkingDirectory       = Path.GetDirectoryName(exePath) ?? ""
            };

            Process.Start(psi);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Watchdog] Spawn xato: {ex.Message}");
        }
    }

    // -----------------------------------------------------------------------
    // Watch Loop — Eski PID o'lganda qayta ishga tushirish
    // -----------------------------------------------------------------------

    private static void StartWatchingPid(int targetPid)
    {
        _watchThread = new Thread(() => WatchLoop(targetPid))
        {
            IsBackground = false, // Daemon emas — WPF muddatidan avval tugatmasin
            Name         = "Watchdog",
            Priority     = ThreadPriority.Normal
        };
        _watchThread.Start();
    }

    private static void WatchLoop(int targetPid)
    {
        // OpenProcess bilan PID handle'ini olish
        IntPtr handle = OpenProcess(PROCESS_SYNCHRONIZE, false, targetPid);
        if (handle == IntPtr.Zero)
        {
            // PID allaqachon yo'q — agar toza chiqish bo'lmasa qayta ishga tushirish
            if (CheckGracefulAndExit()) return;
            RestartMain();
            return;
        }

        try
        {
            // Bloklanib kutadi — jarayon tugaganda WAIT_OBJECT_0 keladi
            uint result = WaitForSingleObject(handle, INFINITE);

            if (result == WAIT_OBJECT_0)
            {
                // Toza chiqish flagini tekshirish
                if (CheckGracefulAndExit()) return;

                // Kutilmagan yopilish bo'lsa 500ms kutib qayta ishga tushirish
                Thread.Sleep(500);
                RestartMain();
            }
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static bool CheckGracefulAndExit()
    {
        try
        {
            if (File.Exists(GracefulExitMarker))
            {
                try { File.Delete(GracefulExitMarker); } catch {}
                Environment.Exit(0);
                return true;
            }
        }
        catch {}
        return false;
    }

    private static void RestartMain()
    {
        try
        {
            string exePath = Process.GetCurrentProcess().MainModule?.FileName
                             ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "NetCafeClient.exe");

            var psi = new ProcessStartInfo
            {
                FileName         = exePath,
                UseShellExecute  = false,
                CreateNoWindow   = false,
                WorkingDirectory = Path.GetDirectoryName(exePath) ?? ""
            };

            Process.Start(psi);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Watchdog] Qayta ishga tushirishda xato: {ex.Message}");
        }
    }
}
