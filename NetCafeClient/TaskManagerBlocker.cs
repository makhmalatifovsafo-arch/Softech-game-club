using System;
using System.Diagnostics;
using System.Collections.Generic;
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
    private static readonly Dictionary<string, Dictionary<string, (object? Value, RegistryValueKind Kind)>> SavedPolicies = new();

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// <summary>Barcha cheklovlarni yoqish (Qulflashda chaqiriladi)</summary>
    public static void EnableRestrictions()
    {
        if (App.IsDevMode) return;
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
                SetTemporaryPolicy(sysKey, SystemPoliciesPath, "DisableTaskMgr", val);
                SetTemporaryPolicy(sysKey, SystemPoliciesPath, "DisableLockWorkstation", val);
                SetTemporaryPolicy(sysKey, SystemPoliciesPath, "DisableChangePassword", val);
                SetTemporaryPolicy(sysKey, SystemPoliciesPath, "DisableRegistryTools", val);
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
                SetTemporaryPolicy(expKey, ExplorerPoliciesPath, "NoLogoff", val);
                SetTemporaryPolicy(expKey, ExplorerPoliciesPath, "NoRun", val);
                SetTemporaryPolicy(expKey, ExplorerPoliciesPath, "NoFind", val);
                SetTemporaryPolicy(expKey, ExplorerPoliciesPath, "NoTrayContextMenu", val);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Policies/Explorer] xato: {ex.Message}");
        }
    }

    private static void SetTemporaryPolicy(RegistryKey key, string path, string name, int value)
    {
        if (!SavedPolicies.TryGetValue(path, out var saved))
            SavedPolicies[path] = saved = new();
        if (!saved.ContainsKey(name))
        {
            // Persist the original value so a watchdog restart does not mistake
            // our temporary restrictions for the club's permanent configuration.
            using var backup = Registry.CurrentUser.CreateSubKey(BackupPath(path), writable: true);
            if (backup.GetValue(name + ".Exists") is int exists)
                saved[name] = (exists == 1 ? backup.GetValue(name + ".Value") : null,
                    (RegistryValueKind)(int)(backup.GetValue(name + ".Kind") ?? (int)RegistryValueKind.DWord));
            else
            {
                object? previous = key.GetValue(name);
                var kind = previous == null ? RegistryValueKind.DWord : key.GetValueKind(name);
                saved[name] = (previous, kind);
                if (previous != null) backup.SetValue(name + ".Value", previous, kind);
                backup.SetValue(name + ".Kind", (int)kind, RegistryValueKind.DWord);
                backup.SetValue(name + ".Exists", previous == null ? 0 : 1, RegistryValueKind.DWord);
                backup.Flush();
            }
        }
        key.SetValue(name, value, RegistryValueKind.DWord);
    }

    private static string BackupPath(string path) => @"SOFTWARE\Softech\KioskPolicyBackup\" +
        (path == SystemPoliciesPath ? "System" : "Explorer");

    private static void RevertPolicies()
    {
        // Restore the club's existing shell policies instead of forcing them all off.
        foreach (var path in SavedPolicies)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(path.Key, writable: true);
                if (key == null) continue;
                foreach (var entry in path.Value)
                {
                    if (entry.Value.Value == null) key.DeleteValue(entry.Key, throwOnMissingValue: false);
                    else key.SetValue(entry.Key, entry.Value.Value, entry.Value.Kind);
                }
                Registry.CurrentUser.DeleteSubKeyTree(BackupPath(path.Key), throwOnMissingSubKey: false);
            }
            catch (Exception ex) { Debug.WriteLine($"[Policies/Restore] {ex.Message}"); }
        }
        SavedPolicies.Clear();
    }

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
