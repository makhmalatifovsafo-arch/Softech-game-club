using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Softech.Updates;

public static class UpdateCleanup
{
    // Only updater-owned GUID directories are eligible. Never follow junctions,
    // including a junction at .ota/updates/staging or anywhere inside a tree.
    public static void DeleteOwnedTree(string target, string relative, Action<string>? log = null)
    {
        try
        {
            string full = PackageManifest.ChildPath(target, relative);
            if (!Directory.Exists(full)) return;
            CheckTree(new DirectoryInfo(full));
            Directory.Delete(full, recursive: true);
        }
        catch (Exception error) { log?.Invoke("Cleanup postponed: " + relative + ": " + error.Message); }
    }

    private static void CheckTree(DirectoryInfo directory)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse point in cleanup tree.");
        foreach (var entry in directory.EnumerateFileSystemInfos())
        {
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse point in cleanup tree.");
            if (entry is DirectoryInfo child) CheckTree(child);
        }
    }

    // Caller holds .ota/update.lock for the entire transaction, including health
    // verification. Keep this transaction's rollback files, remove older ones.
    public static void AfterSuccess(string target, string version, string transaction, Action<string>? log = null)
    {
        var keep = Path.GetFileName(transaction);
        if (!Guid.TryParseExact(keep, "N", out _)) throw new InvalidDataException("Invalid retention transaction.");
        string ota = PackageManifest.ChildPath(target, ".ota");
        if (File.GetAttributes(ota).HasFlag(FileAttributes.ReparsePoint)) return;
        foreach (string dir in Directory.GetDirectories(ota))
        {
            string name = Path.GetFileName(dir);
            if (name != keep && Guid.TryParseExact(name, "N", out _)) DeleteOwnedTree(target, ".ota/" + name, log);
        }
        DeleteOwnedTree(target, ".ota/" + keep + "/prepared", log);
        CleanStaging(target, version, log);
    }

    public static void CleanStaging(string target, string version, Action<string>? log = null)
    {
        if (!Version.TryParse(version, out var installed)) return;
        string staging = PackageManifest.ChildPath(target, "updates/staging");
        if (!Directory.Exists(staging) || File.GetAttributes(staging).HasFlag(FileAttributes.ReparsePoint)) return;
        foreach (string dir in Directory.GetDirectories(staging))
        {
            string name = Path.GetFileName(dir);
            var candidate = Regex.Match(name, @"^v(\d+\.\d+\.\d+)-([a-fA-F0-9-]+)$");
            if (candidate.Success && Guid.TryParse(candidate.Groups[2].Value, out _) &&
                Version.TryParse(candidate.Groups[1].Value, out var staged) && staged <= installed)
            {
                DeleteOwnedTree(target, "updates/staging/" + name, log);
                continue;
            }
            if (!name.StartsWith("handover-") || !Guid.TryParse(name[9..], out _)) continue;
            // The currently running helper cannot remove its own EXE on Windows.
            string executable = Environment.ProcessPath ?? "";
            if (Path.GetFullPath(executable).StartsWith(Path.GetFullPath(dir) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                string planPath = PackageManifest.ChildPath(target, "updates/staging/" + name + "/plan.json");
                var plan = JsonSerializer.Deserialize<UpdatePlan>(File.ReadAllText(planPath), PackageManifest.JsonOptions);
                if (plan == null || !Path.GetFullPath(plan.Target).TrimEnd(Path.DirectorySeparatorChar).Equals(
                    Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) continue;
                if (Version.TryParse(plan.Version, out var handover) && handover <= installed)
                    DeleteOwnedTree(target, "updates/staging/" + name, log);
            }
            catch (Exception error) { log?.Invoke("Cleanup skipped unknown handover: " + error.Message); }
        }
    }

    // Startup cleanup is serialized with every live updater. A restarted app
    // may reach this while its health is still being checked: in that case skip.
    public static void OnStartup(string target, string version, Action<string>? log = null)
    {
        try
        {
            string lockPath = PackageManifest.ChildPath(target, ".ota/update.lock");
            Directory.CreateDirectory(Path.GetDirectoryName(lockPath)!);
            using var guard = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            CleanStaging(target, version, log);
        }
        catch (Exception error) { log?.Invoke("Cleanup deferred: " + error.Message); }
    }
}
