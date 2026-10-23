using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;

namespace NetCafeClient.Services.Security;

/// <summary>
/// ProcessExecutionGuard — Anti-Cheat & Script Blocker.
/// 1. Task Manager, Process Hacker, CMD, Registry Editor kabi tizim vositalarini bloklangan holatda ushlaydi.
/// 2. USB yoki Temp papkalaridan ishga tushishga uringan skriptlar (.bat, .cmd, .ps1, .vbs) va
///    shubhali jarayonlarni aniqlab, darhol o'ldiradi (p.Kill()).
/// </summary>
public sealed class ProcessGuardService : IDisposable
{
    private static readonly Lazy<ProcessGuardService> _instance = new(() => new ProcessGuardService());
    public static ProcessGuardService Instance => _instance.Value;

    private Thread? _guardThread;
    private volatile bool _isRunning = false;
    private readonly object _lock = new();

    // Bloklangan boshqaruv va xakerlik vositalari ro'yxati
    private static readonly HashSet<string> BlacklistedProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "taskmgr",
        "processhacker",
        "processhacker2",
        "procmon",
        "procmon64",
        "procexp",
        "procexp64",
        "cheatengine-x86_64",
        "cheatengine-i386",
        "cheatengine",
        "x64dbg",
        "x32dbg",
        "ida64",
        "ida",
        "cmd",
        "powershell",
        "pwsh",
        "powershell_ise",
        "regedit",
        "mmc",
        "msconfig",
        "resmon",
        "perfmon",
        "wscript",
        "cscript",
        "mshta"
    };

    // Shubhali skript kengaytmalari
    private static readonly HashSet<string> SuspiciousScriptExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".bat",
        ".cmd",
        ".ps1",
        ".vbs",
        ".vbe",
        ".js",
        ".jse",
        ".wsf",
        ".wsh",
        ".hta"
    };

    private string _tempPath = string.Empty;
    private string _localAppDataTemp = string.Empty;

    private ProcessGuardService()
    {
        try
        {
            _tempPath = Path.GetTempPath().TrimEnd('\\');
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            _localAppDataTemp = Path.Combine(localAppData, "Temp").TrimEnd('\\');
        }
        catch { /* ignore */ }
    }

    /// <summary>
    /// Process Guard xizmatini ishga tushirish
    /// </summary>
    public void Start()
    {
        lock (_lock)
        {
            if (_isRunning) return;
            _isRunning = true;

            _guardThread = new Thread(GuardLoop)
            {
                IsBackground = true,
                Priority = ThreadPriority.Lowest,
                Name = "Process-Guard"
            };
            _guardThread.Start();

            Debug.WriteLine("🛡️ [ProcessGuardService] Jarayonlar xavfsizlik nazorati yoqildi.");
        }
    }

    /// <summary>
    /// Process Guard xizmatini to'xtatish
    /// </summary>
    public void Stop()
    {
        lock (_lock)
        {
            _isRunning = false;
        }
    }

    private void GuardLoop()
    {
        int myPid = Environment.ProcessId;

        while (_isRunning)
        {
            try
            {
                Process[] processes = Process.GetProcesses();

                foreach (var p in processes)
                {
                    if (p.Id == myPid || p.Id <= 4) continue;

                    string pName = p.ProcessName;

                    // 1. Qora ro'yxatdagi tizim/debug vositalarini tekshirish
                    if (BlacklistedProcessNames.Contains(pName))
                    {
                        KillProcessImmediately(p, $"Tizim yoki xavfsizlik vositasi bloklandi: {pName}");
                        continue;
                    }

                    // 2. USB drayveri va Temp katalogidan ishga tushgan jarayonlarni tekshirish
                    InspectProcessPath(p);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"⚠️ [ProcessGuardService] GuardLoop xatosi: {ex.Message}");
            }

            Thread.Sleep(250);
        }
    }

    private void InspectProcessPath(Process p)
    {
        string? exePath = null;
        try
        {
            // Ba'zi tizim jarayonlari uchun MainModule ruxsat bermasligi mumkin
            exePath = p.MainModule?.FileName;
        }
        catch
        {
            return;
        }

        if (string.IsNullOrEmpty(exePath)) return;

        try
        {
            // A) USB / Removable drayveridan ishga tushishga uringan jarayonlar
            string? root = Path.GetPathRoot(exePath);
            if (!string.IsNullOrEmpty(root) && root.Length >= 2 && root[1] == ':')
            {
                char driveLetter = char.ToUpper(root[0]);
                if (driveLetter != 'C' && driveLetter != 'D')
                {
                    uint driveType = Win32SecurityNative.GetDriveType(root);
                    if (driveType == Win32SecurityNative.DRIVE_REMOVABLE || driveType == Win32SecurityNative.DRIVE_CDROM)
                    {
                        KillProcessImmediately(p, $"USB xotiradan dastur ishga tushishi bloklandi: {p.ProcessName} ({exePath})");
                        return;
                    }
                }
            }

            // B) Temp papkasidan ishga tushgan shubhali skriptlar yoki fayllar
            bool isInTemp = (!string.IsNullOrEmpty(_tempPath) && exePath.StartsWith(_tempPath, StringComparison.OrdinalIgnoreCase)) ||
                            (!string.IsNullOrEmpty(_localAppDataTemp) && exePath.StartsWith(_localAppDataTemp, StringComparison.OrdinalIgnoreCase));

            if (isInTemp)
            {
                string ext = Path.GetExtension(exePath);
                if (SuspiciousScriptExtensions.Contains(ext) || IsSuspiciousTempExe(p.ProcessName))
                {
                    KillProcessImmediately(p, $"Temp papkasidan shubhali jarayon bloklandi: {p.ProcessName} ({exePath})");
                }
            }
        }
        catch { /* ignore */ }
    }

    private static bool IsSuspiciousTempExe(string processName)
    {
        // Temp papkasidan ishga tushadigan cheat/hack/inject launcherlar
        string lower = processName.ToLowerInvariant();
        return lower.Contains("cheat") ||
               lower.Contains("injector") ||
               lower.Contains("loader") ||
               lower.Contains("bypass") ||
               lower.Contains("hack") ||
               lower.Contains("spoofer") ||
               lower.StartsWith("cmd") ||
               lower.StartsWith("powershell");
    }

    private static void KillProcessImmediately(Process p, string reason)
    {
        try
        {
            string name = p.ProcessName;
            p.Kill(entireProcessTree: true);
            Debug.WriteLine($"🚨 [ProcessGuardService] JARAYON O'LDIRILDI: {reason}");

            SecurityAlertOverlay.ShowAlert(
                title: "Xavfsizlik: Shubhali jarayon to'xtatildi!",
                message: $"Tizim xavfsizlik siyosati buzildi: [{name}] jarayoni bloklandi va to'xtatildi.");
        }
        catch { /* ignore */ }
    }

    public void Dispose()
    {
        Stop();
    }
}
