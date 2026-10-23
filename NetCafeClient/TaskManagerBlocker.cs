using System;
using System.Diagnostics;
using System.Threading;
using Microsoft.Win32;

namespace NetCafeClient;

/// <summary>
/// Registry Policy Service — "Temir Qulf" Tizim Cheklovlari.
/// HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System orqali:
///   DisableTaskMgr, DisableLockWorkstation, DisableChangePassword, NoLogoff
/// Atomic ApplyPolicies() va RevertPolicies() metodlari.
/// Qo'shimcha: Taskmgr.exe ko'rinishi bilanoq o'ldiruvchi background watcher.
/// </summary>
public static class TaskManagerBlocker
{
    private const string SystemPoliciesPath  = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System";
    private const string ExplorerPoliciesPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer";

    private static Thread? _watcherThread;
    private static volatile bool _isRunning = false;

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// <summary>Barcha cheklovlarni yoqish (Qulflashda chaqiriladi)</summary>
    public static void EnableRestrictions()
    {
        ApplyPolicies(enable: true);
        StartWatcher();
    }

    /// <summary>Barcha cheklovlarni olib tashlash (Ochishda chaqiriladi)</summary>
    public static void DisableRestrictions()
    {
        _isRunning = false;
        RevertPolicies();
    }

    // -----------------------------------------------------------------------
    // Registry Policy Operations
    // -----------------------------------------------------------------------

    private static void ApplyPolicies(bool enable)
    {
        int val = enable ? 1 : 0;
        try
        {
            using var sysKey = Registry.CurrentUser.CreateSubKey(SystemPoliciesPath, writable: true);
            if (sysKey != null)
            {
                sysKey.SetValue("DisableTaskMgr",         val, RegistryValueKind.DWord);
                sysKey.SetValue("DisableLockWorkstation", val, RegistryValueKind.DWord);
                sysKey.SetValue("DisableChangePassword",  val, RegistryValueKind.DWord);
                sysKey.SetValue("NoLogoff",               val, RegistryValueKind.DWord);
                sysKey.SetValue("DisableRegistryTools",   val, RegistryValueKind.DWord);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Policies/System] xato: {ex.Message}");
        }

        try
        {
            using var expKey = Registry.CurrentUser.CreateSubKey(ExplorerPoliciesPath, writable: true);
            if (expKey != null)
            {
                expKey.SetValue("NoRun",           val, RegistryValueKind.DWord);
                expKey.SetValue("NoFind",          val, RegistryValueKind.DWord);
                expKey.SetValue("NoTrayContextMenu", val, RegistryValueKind.DWord);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Policies/Explorer] xato: {ex.Message}");
        }
    }

    private static void RevertPolicies() => ApplyPolicies(enable: false);

    // -----------------------------------------------------------------------
    // Process Watcher — Taskmgr.exe ko'rinishi bilanoq o'ldirish
    // -----------------------------------------------------------------------

    private static void StartWatcher()
    {
        if (_isRunning) return;
        _isRunning = true;

        _watcherThread = new Thread(WatcherLoop)
        {
            IsBackground = true,
            Priority     = ThreadPriority.Lowest,
            Name         = "TM-Watcher"
        };
        _watcherThread.Start();
    }

    private static void WatcherLoop()
    {
        string[] targets = { "Taskmgr", "regedit", "cmd", "powershell", "mmc" };

        while (_isRunning)
        {
            foreach (string name in targets)
            {
                try
                {
                    foreach (var p in Process.GetProcessesByName(name))
                    {
                        try { p.Kill(); } catch { /* ignore */ }
                    }
                }
                catch { /* ignore */ }
            }

            Thread.Sleep(400);
        }
    }
}
