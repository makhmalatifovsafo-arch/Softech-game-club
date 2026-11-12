using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace Softech.Updates;

public sealed class UpdatePlan
{
    public string Source { get; set; } = "";
    public string Target { get; set; } = "";
    public string Version { get; set; } = "";
    public string Kind { get; set; } = "";
    public int[] ParentPids { get; set; } = Array.Empty<int>();
    public string RestartExecutable { get; set; } = "";
    public string[] RestartArguments { get; set; } = Array.Empty<string>();
    public string ReadyFile { get; set; } = "";
    public string CommitFile { get; set; } = "";
    public string CancelFile { get; set; } = "";
    public string HealthFile { get; set; } = "";
    public string? HealthUrl { get; set; }
    public int TimeoutSeconds { get; set; } = 60;
}

public sealed class PackageManifest
{
    public string Version { get; set; } = "";
    public string Kind { get; set; } = "";
    public Dictionary<string, string> Files { get; set; } = new();

    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };

    public static bool Preserved(string relative)
    {
        var normalized = relative.Replace('\\', '/');
        var name = Path.GetFileName(normalized);
        return normalized.StartsWith(".ota/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("data/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("updates/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("logs/", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("config.json", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith(".graceful_exit", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".db", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".db-wal", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".db-shm", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".db-journal", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".sqlite", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".sqlite3", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".log", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".sig", StringComparison.OrdinalIgnoreCase);
    }

    public static string ChildPath(string root, string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(':'))
            throw new InvalidDataException("Invalid package path.");
        string basePath = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(basePath, relative));
        if (!full.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Package path leaves its directory.");
        // Never traverse a junction/symlink, including pre-existing target paths.
        for (var cursor = new DirectoryInfo(Path.GetDirectoryName(full)!); cursor != null; cursor = cursor.Parent)
        {
            if (cursor.Exists && cursor.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("Reparse points are not allowed in update paths.");
        }
        if (File.Exists(full) && File.GetAttributes(full).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Reparse point file.");
        return full;
    }

    public static PackageManifest Validate(string source, string version, string kind)
    {
        var manifest = JsonSerializer.Deserialize<PackageManifest>(
            File.ReadAllText(Path.Combine(source, "update-package.json")), JsonOptions)
            ?? throw new InvalidDataException("Package manifest missing.");
        if (manifest.Version != version || manifest.Kind != kind || manifest.Files.Count == 0)
            throw new InvalidDataException("Package version/kind mismatch.");
        string required = kind == "client" ? "NetCafeClient.exe" : "src/server.js";
        if (!manifest.Files.ContainsKey(required) || !manifest.Files.ContainsKey("SoftechUpdater.exe"))
            throw new InvalidDataException("Incomplete update package.");
        foreach (var file in manifest.Files)
        {
            if (Preserved(file.Key)) throw new InvalidDataException("Package contains local configuration or data.");
            string path = ChildPath(source, file.Key);
            using var stream = File.OpenRead(path);
            string hash = Convert.ToHexString(SHA256.HashData(stream));
            if (!hash.Equals(file.Value, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Package integrity failure: " + file.Key);
        }
        return manifest;
    }
}
