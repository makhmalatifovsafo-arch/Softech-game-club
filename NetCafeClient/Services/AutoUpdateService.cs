using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Softech.Updates;

namespace NetCafeClient.Services;

public sealed class AutoUpdateService
{
    public static AutoUpdateService Instance { get; } = new();
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(15) };
    private readonly SemaphoreSlim checkLock = new(1, 1);
    private readonly SemaphoreSlim applyLock = new(1, 1);
    private readonly CancellationTokenSource stopping = new();
    private Func<bool>? sessionActive;
    private Func<bool>? maintenance;
    private string? staged;
    private string? stagedVersion;
    private int idleSeconds = 10;
    private DateTime nextApplyAttempt;
    private readonly string root = AppContext.BaseDirectory;
    private readonly string staging;
    public string CurrentVersion { get; } = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";
    public string? StagedVersion => stagedVersion;
    public bool IsUpdateStaged => staged != null;
    public bool IsChecking { get; private set; }
    public bool IsDownloading { get; private set; }
    public string? ManifestUrl { get; set; }

    private AutoUpdateService()
    {
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Softech-Updater/2.0");
        // Per-installation staging avoids collisions between separate installations.
        staging = Path.Combine(root, "updates", "staging");
    }

    public void Initialize(string? manifestUrl, Func<bool> isSessionActiveFunc, Func<bool>? isMaintenance = null)
    {
        sessionActive = isSessionActiveFunc;
        maintenance = isMaintenance;
        ManifestUrl = manifestUrl;
        try
        {
            using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "config.json")));
            if (config.RootElement.TryGetProperty("updateIdleSeconds", out var idle))
                idleSeconds = idle.GetInt32() == 30 ? 10 : Math.Clamp(idle.GetInt32(), 5, 3600);
            if (ManifestUrl == null && config.RootElement.TryGetProperty("updateManifestUrl", out var url))
                ManifestUrl = url.GetString();
        }
        catch { }
        ManifestUrl ??= "https://github.com/makhmalatifovsafo-arch/Softech-game-club/releases/latest/download/version.json";
        Directory.CreateDirectory(staging);
    }

    public void StartPeriodicChecks(TimeSpan? interval = null)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stopping.Token);
                while (!stopping.IsCancellationRequested)
                {
                    await CheckForUpdatesAsync();
                    await Task.Delay(interval ?? TimeSpan.FromSeconds(60), stopping.Token);
                }
            }
            catch (OperationCanceledException) { }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
                while (await timer.WaitForNextTickAsync(stopping.Token)) await TryApplyAsync();
            }
            catch (OperationCanceledException) { }
        });
    }

    public void Stop() => stopping.Cancel();
    public void OnSessionEnded() { /* The one-second safety loop makes the decision. */ }
    public void ApplyStagedUpdate() => _ = TryApplyAsync(); // Manual callers cannot bypass safety.

    public async Task<bool> CheckForUpdatesAsync()
    {
        if (!await checkLock.WaitAsync(0)) return false;
        IsChecking = true;
        try
        {
            using var response = await http.GetAsync(ManifestUrl, stopping.Token);
            if (!response.IsSuccessStatusCode) return false;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(stopping.Token));
            var manifest = document.RootElement;
            string version = manifest.GetProperty("version").GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+$") ||
                Version.Parse(version) <= Version.Parse(CurrentVersion)) return false;
            if (IsFailedVersion(version) || stagedVersion == version) return false;
            var file = manifest.GetProperty("client");
            string url = file.TryGetProperty("downloadUrl", out var download) ? download.GetString()! : file.GetProperty("url").GetString()!;
            string hash = file.GetProperty("sha256").GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("SHA256 is required.");
            var uri = new Uri(url);
            if (uri.Scheme != "https" && !(uri.IsLoopback && uri.Scheme == "http")) throw new InvalidDataException("HTTPS download required.");

            IsDownloading = true;
            string candidate = Path.Combine(staging, "v" + version + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(candidate);
            string zip = Path.Combine(candidate, "download.zip");
            using (var downloadResponse = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, stopping.Token))
            {
                downloadResponse.EnsureSuccessStatusCode();
                await using var stream = await downloadResponse.Content.ReadAsStreamAsync(stopping.Token);
                await using var destination = File.Create(zip);
                await stream.CopyToAsync(destination, stopping.Token);
            }
            using (var stream = File.OpenRead(zip))
            {
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(hash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Downloaded package SHA256 mismatch.");
            }
            string extracted = Path.Combine(candidate, "package");
            ZipFile.ExtractToDirectory(zip, extracted);
            PackageManifest.Validate(extracted, version, "client");
            File.Delete(zip);
            // Publish the staged state only after the whole package is validated.
            staged = extracted;
            stagedVersion = version;
            return true;
        }
        catch (Exception ex) { Log(ex.Message); return false; }
        finally { IsChecking = false; IsDownloading = false; checkLock.Release(); }
    }

    private bool IsFailedVersion(string version)
    {
        try
        {
            using var failed = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "updates-failed-version.json")));
            return failed.RootElement.GetProperty("version").GetString() == version;
        }
        catch { return false; }
    }

    private bool SafeOnUiThread(bool programsOpen, double idle)
    {
        var app = System.Windows.Application.Current;
        if (app == null || app.Dispatcher.HasShutdownStarted) return false;
        return app.Dispatcher.Invoke(() => IdleSafety.CanApply(sessionActive?.Invoke() ?? true,
            maintenance?.Invoke() ?? true, idle, programsOpen, idleSeconds) && !App.IsDevMode);
    }

    private async Task TryApplyAsync()
    {
        if (staged == null || stagedVersion == null || DateTime.UtcNow < nextApplyAttempt ||
            IsDownloading || !await applyLock.WaitAsync(0)) return;
        string? cancel = null;
        try
        {
            if (!SafeOnUiThread(false, IdleSafety.IdleSeconds())) return;
            if (IdleSafety.HasUserPrograms(root)) return;
            string handover = Path.Combine(staging, "handover-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(handover);
            string updater = Path.Combine(handover, "SoftechUpdater.exe");
            File.Copy(Path.Combine(staged, "SoftechUpdater.exe"), updater);
            var plan = new UpdatePlan
            {
                Source = staged, Target = root, Version = stagedVersion, Kind = "client",
                ParentPids = new[] { Environment.ProcessId }, RestartExecutable = Path.Combine(root, "NetCafeClient.exe"),
                ReadyFile = Path.Combine(handover, "ready"), CommitFile = Path.Combine(handover, "commit"),
                CancelFile = Path.Combine(handover, "cancel"), HealthFile = Path.Combine(handover, "healthy")
            };
            cancel = plan.CancelFile;
            string planPath = Path.Combine(handover, "plan.json");
            File.WriteAllText(planPath, JsonSerializer.Serialize(plan, PackageManifest.JsonOptions));
            var info = new ProcessStartInfo(updater)
            {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = handover
            };
            info.ArgumentList.Add("--plan"); info.ArgumentList.Add(planPath);
            using var helper = Process.Start(info) ?? throw new IOException("Updater did not start.");
            var deadline = DateTime.UtcNow.AddSeconds(55);
            while (!File.Exists(plan.ReadyFile))
            {
                if (helper.HasExited || File.Exists(plan.ReadyFile + ".error") || DateTime.UtcNow > deadline)
                    throw new IOException("Updater preparation failed; keeping the current client running.");
                await Task.Delay(100, stopping.Token);
            }
            // Recheck after all disk I/O. A newly started game or mouse movement cancels handover.
            bool programsOpen = IdleSafety.HasUserPrograms(root);
            var app = System.Windows.Application.Current;
            app.Dispatcher.Invoke(() =>
            {
                if (!IdleSafety.CanApply(sessionActive?.Invoke() ?? true, maintenance?.Invoke() ?? true,
                    IdleSafety.IdleSeconds(), programsOpen, idleSeconds))
                    throw new InvalidOperationException("Computer became busy; update postponed.");
                WatchdogService.PrepareForUpdate();
                File.WriteAllText(plan.CommitFile, stagedVersion);
                cancel = null;
                app.Shutdown(0);
            });
        }
        catch (Exception ex) { nextApplyAttempt = DateTime.UtcNow.AddSeconds(60); Log(ex.Message); }
        finally
        {
            if (cancel != null) try { File.WriteAllText(cancel, "cancel"); } catch { }
            applyLock.Release();
        }
    }

    private static void Log(string message) => Debug.WriteLine("[AutoUpdate] " + message);
}
