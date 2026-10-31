using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace Softech.Updates;

public static class IdleSafety
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LastInput { public uint Size; public uint Tick; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInput input);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, System.Text.StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr window);
    private static string ImagePath(int pid)
    {
        IntPtr handle = OpenProcess(0x1000, false, pid); // QUERY_LIMITED_INFORMATION, no process memory access.
        if (handle == IntPtr.Zero) return "";
        try
        {
            var buffer = new System.Text.StringBuilder(32768);
            int length = buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref length) ? buffer.ToString() : "";
        }
        finally { CloseHandle(handle); }
    }
    private delegate bool EnumWindow(IntPtr window, IntPtr data);

    public static double IdleSeconds()
    {
        var input = new LastInput { Size = (uint)Marshal.SizeOf<LastInput>() };
        if (!GetLastInputInfo(ref input)) return -1; // Unknown is never idle.
        return unchecked((uint)Environment.TickCount - input.Tick) / 1000.0;
    }

    public static bool CanApply(bool sessionActive, bool maintenance, double idleSeconds,
        bool userProgramOpen, int minimumIdleSeconds = 10) =>
        !sessionActive && !maintenance && idleSeconds >= Math.Max(5, minimumIdleSeconds) && !userProgramOpen;

    // Include minimized windows and background games/launchers in the interactive session.
    // Unknown/inaccessible user processes block updates instead of risking a player's game.
    public static bool HasUserPrograms(string applicationDirectory)
    {
        using var own = Process.GetCurrentProcess();
        var visiblePids = new HashSet<int>();
        if (!EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window)) return true;
            var cls = new System.Text.StringBuilder(256);
            GetClassName(window, cls, cls.Capacity);
            if (cls.ToString() is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd")
                return true; // Desktop/taskbar, not an open Explorer folder.
            GetWindowThreadProcessId(window, out var pid);
            if (GetWindowTextLength(window) > 0) visiblePids.Add((int)pid);
            return true;
        }, IntPtr.Zero)) return true;

        var windows = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.Windows)) + Path.DirectorySeparatorChar;
        var app = Path.GetFullPath(applicationDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    if (process.Id == own.Id || process.SessionId != own.SessionId || process.HasExited) continue;
                    string exe = ImagePath(process.Id);
                    string name = process.ProcessName;
                    bool companion = exe.StartsWith(app, StringComparison.OrdinalIgnoreCase) &&
                        (name.Equals("NetCafeClient", StringComparison.OrdinalIgnoreCase) ||
                         name.Equals("SoftechUpdater", StringComparison.OrdinalIgnoreCase));
                    if (companion) continue;
                    if (visiblePids.Contains(process.Id)) return true;
                    if (string.IsNullOrEmpty(exe) || !exe.StartsWith(windows, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch (InvalidOperationException) { /* Process exited while enumerating. */ }
                catch { return true; }
            }
        }
        return false;
    }
}
