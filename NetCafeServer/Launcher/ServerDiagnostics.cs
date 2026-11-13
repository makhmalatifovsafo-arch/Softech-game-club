using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace SoftechCockpit;

// Runs in the launcher, not in Node. Neither exports nor uploads stderr,
// config contents, hardware identifiers, account data or filesystem paths.
public sealed class ServerDiagnostics
{
    private readonly HttpClient _http;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _lastAttempt = DateTimeOffset.MinValue;
    public string DeliveryState { get; private set; } = "NOT_SENT";
    private static readonly HttpClient DefaultHttp = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) };
    public ServerDiagnostics(HttpClient? http = null) => _http = http ?? DefaultHttp;

    internal static JsonElement? ReadObject(string file)
    {
        try {
            if (new FileInfo(file).Length > 262144) return null;
            using var parsed = JsonDocument.Parse(File.ReadAllText(file));
            return parsed.RootElement.ValueKind == JsonValueKind.Object ? parsed.RootElement.Clone() : null;
        } catch { return null; }
    }
    internal static string? Text(JsonElement? obj, string key) => obj.HasValue && obj.Value.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static string? Version(string? value) => value != null && Regex.IsMatch(value, @"^\d{1,4}\.\d{1,4}\.\d{1,4}$") ? value : null;
    private static string? Stamp(string? value) => DateTimeOffset.TryParse(value, out var parsed) ? parsed.ToUniversalTime().ToString("O") : null;

    public static string Classify(string? error)
    {
        string text = error ?? "";
        if (text.Contains("SERVER_ALREADY_RUNNING")) return "SERVER_ALREADY_RUNNING";
        if (text.Contains("SERVER_INSTANCE_LOCK_FAILED")) return "SERVER_INSTANCE_LOCK_FAILED";
        if (text.Contains("UPDATE_RECOVERY_REQUIRED") || text.Contains("Rollback backup integrity failure") || text.Contains("Update journal") || text.Contains("Recovery postponed")) return "UPDATE_RECOVERY_REQUIRED";
        if (text.Contains("ENOSPC") || text.Contains("SQLITE_FULL")) return "DISK_FULL";
        if (text.Contains("EACCES") || text.Contains("EPERM")) return "ACCESS_DENIED";
        if (text.Contains("SQLITE_CORRUPT") || text.Contains("SQLITE_NOTADB") || text.Contains("database disk image is malformed") || text.Contains("file is not a database")) return "DATABASE_INVALID";
        if (text.Contains("Asosiy baza topilmadi")) return "DATABASE_MISSING";
        if (text.Contains("EADDRINUSE") || text.Contains("5000-port band")) return "PORT_BUSY";
        if (text.Contains("INVALID_SERVER_CONFIG") || (text.Contains("JSON") && (text.Contains("config.json") || text.Contains("LicenseManager.init")))) return "CONFIG_INVALID";
        if (text.Contains("node.exe") && text.Contains("topilmadi")) return "RUNTIME_MISSING";
        if (text.Contains("src/server.js") && text.Contains("topilmadi")) return "SCRIPT_MISSING";
        if (text.Contains("Server hali tayyor emas")) return "START_TIMEOUT";
        return "UNKNOWN";
    }

    public static Dictionary<string, object?> Collect(string directory, string state, string errorCode, DateTimeOffset? observedAt = null)
    {
        string configFile = Path.Combine(directory, "config.json");
        string configState;
        try { configState = !File.Exists(configFile) ? "MISSING" : ReadObject(configFile).HasValue ? "OK" : "INVALID"; }
        catch { configState = "UNREADABLE"; }
        long? free = null;
        try { free = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(directory))!).AvailableFreeSpace; } catch { }
        string? backup = null;
        try {
            foreach (string file in Directory.EnumerateFiles(Path.Combine(directory, "data", "backups"), "*.db")) {
                var match = Regex.Match(Path.GetFileName(file), @"^(startup|hourly|daily|setup)-(\d{13})-[a-f0-9-]{36}\.db$");
                if (!match.Success || new FileInfo(file).Length == 0) continue;
                var stamp = DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(match.Groups[2].Value)).ToString("O");
                if (backup == null || string.CompareOrdinal(stamp, backup) > 0) backup = stamp;
            }
        } catch { }
        var backupHealth = ReadObject(Path.Combine(directory, "data", "backup-health.json"));
        string backupError = Text(backupHealth, "errorCode") ?? "UNKNOWN";
        if (!new[] { "NONE", "DISK_FULL", "ACCESS_DENIED", "DATABASE_INVALID", "BACKUP_FAILED", "UNKNOWN" }.Contains(backupError)) backupError = "UNKNOWN";
        var assemblyVersion = typeof(ServerDiagnostics).Assembly.GetName().Version;
        return new() {
            ["schemaVersion"] = 1, ["observedAt"] = (observedAt ?? DateTimeOffset.UtcNow).ToString("O"),
            ["backendState"] = state, ["errorCode"] = errorCode == "NONE" && configState == "INVALID" ? "CONFIG_INVALID" : errorCode, ["configState"] = configState,
            ["serverVersion"] = Version(Text(ReadObject(Path.Combine(directory, "package.json")), "version")),
            ["launcherVersion"] = assemblyVersion == null ? null : $"{assemblyVersion.Major}.{assemblyVersion.Minor}.{assemblyVersion.Build}",
            ["lastBackupAt"] = Stamp(backup), ["backupError"] = backupError,
            ["freeDiskBytes"] = free, ["databasePresent"] = File.Exists(Path.Combine(directory, "netcafe.db"))
        };
    }

    public static string Export(Dictionary<string, object?> report) => JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });

    public async Task SendAsync(string directory, Dictionary<string, object?> report, CancellationToken cancellation = default)
    {
        if (!await _gate.WaitAsync(0, cancellation)) return;
        try {
            if (DateTimeOffset.UtcNow - _lastAttempt < TimeSpan.FromSeconds(30)) return;
            _lastAttempt = DateTimeOffset.UtcNow;
            var license = ReadObject(Path.Combine(directory, "data", "softech_license.sig"));
            if (!license.HasValue || !license.Value.TryGetProperty("payload", out var payload) ||
                !payload.TryGetProperty("clubId", out var id) || !long.TryParse(id.ToString(), out var clubId) || clubId <= 0) { DeliveryState = "IDENTITY_UNAVAILABLE"; return; }
            var config = ReadObject(Path.Combine(directory, "config.json")) ?? ReadObject(Path.Combine(directory, "config.json.last-good"));
            string? address = Environment.GetEnvironmentVariable("SOFTECH_CLOUD_URL");
            if (string.IsNullOrWhiteSpace(address)) address = config.HasValue ? Text(config, "cloudUrl") ?? "https://softech-game-club.vercel.app" : null;
            if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0) { DeliveryState = "CLOUD_ADDRESS_UNAVAILABLE"; return; }
            var body = JsonSerializer.Serialize(new { clubId, signedLicense = license.Value, report });
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            using var response = await _http.PostAsync(address!.TrimEnd('/') + "/api/telemetry/diagnostics", content, cancellation);
            DeliveryState = response.IsSuccessStatusCode ? "SENT" : response.StatusCode == System.Net.HttpStatusCode.Unauthorized ? "IDENTITY_REJECTED" : "CLOUD_REJECTED";
        } catch (OperationCanceledException) { DeliveryState = "NETWORK_UNAVAILABLE"; }
          catch { DeliveryState = "NETWORK_UNAVAILABLE"; }
        finally { _gate.Release(); }
    }
}
