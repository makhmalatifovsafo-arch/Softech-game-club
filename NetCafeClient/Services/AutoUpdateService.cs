using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Softech.Updates;

namespace NetCafeClient.Services;

public sealed record ClientUpdateReport(
    string Status,
    string CurrentVersion,
    string? TargetVersion,
    long? CommandId,
    string? Error,
    string? ReceiptId,
    DateTimeOffset UpdatedAt);

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
    private readonly object stateLock = new();
    private ClientUpdateReport updateReport;
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
        updateReport = LoadReport();
        if (updateReport.Status == "INSTALLING" && updateReport.TargetVersion == CurrentVersion)
            SetReport("VERIFYING", CurrentVersion, updateReport.CommandId, null,
                updateReport.ReceiptId ?? Guid.NewGuid().ToString("N"));
        else if ((updateReport.Status is "INSTALLING" or "VERIFYING") && updateReport.TargetVersion is { } failed && IsFailedVersion(failed))
            SetReport("ERROR", failed, updateReport.CommandId, "Yangi versiya sog‘lom ishga tushmadi; oldingi client tiklandi.", updateReport.ReceiptId);
    }

    public ClientUpdateReport GetReport()
    {
        lock (stateLock) return updateReport;
    }

    public void ConfirmInstalled()
    {
        var report=GetReport();
        if (report.Status == "VERIFYING" && report.TargetVersion == CurrentVersion)
            SetReport("INSTALLED", CurrentVersion, report.CommandId, null, report.ReceiptId);
    }

    private ClientUpdateReport LoadReport()
    {
        try
        {
            var saved = JsonSerializer.Deserialize<ClientUpdateReport>(File.ReadAllText(Path.Combine(root, "client-update-state.json")));
            if (saved != null) return saved with { CurrentVersion = CurrentVersion };
        }
        catch { }
        return new("IDLE", CurrentVersion, null, null, null, null, DateTimeOffset.UtcNow);
    }

    private void SetReport(string status, string? target = null, long? commandId = null, string? error = null, string? receiptId = null, bool resetCommand = false)
    {
        ClientUpdateReport report;
        lock (stateLock)
        {
            string? nextTarget=target ?? updateReport.TargetVersion;
            long? nextCommand=resetCommand ? commandId : commandId ?? updateReport.CommandId;
            string? nextError=string.IsNullOrWhiteSpace(error) ? null : error[..Math.Min(error.Length, 300)];
            string? nextReceipt=receiptId ?? updateReport.ReceiptId;
            if (updateReport.Status==status && updateReport.CurrentVersion==CurrentVersion && updateReport.TargetVersion==nextTarget &&
                updateReport.CommandId==nextCommand && updateReport.Error==nextError && updateReport.ReceiptId==nextReceipt) return;
            report = new(status, CurrentVersion, target ?? updateReport.TargetVersion,
                nextCommand, nextError, nextReceipt, DateTimeOffset.UtcNow);
            updateReport = report;
        }
        try
        {
            string file = Path.Combine(root, "client-update-state.json"), temporary = file + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(report, PackageManifest.JsonOptions));
            File.Move(temporary, file, true);
        }
        catch { }
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
        // Update storage is optional at startup; create it inside the guarded
        // download operation so disk/permission failures cannot stop the kiosk.
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
    public async Task<bool> ForceCheckAsync(long? commandId = null, string? requestedVersion = null)
    {
        // A remote request accelerates download/staging, but applying still waits
        // for the kiosk to have no active session and no maintenance window.
        SetReport("REQUESTED", requestedVersion, commandId, null, Guid.NewGuid().ToString("N"));
        bool found = await CheckForUpdatesAsync(commandId);
        if (!found && !IsUpdateStaged && GetReport().Status == "CHECKING")
            SetReport("INSTALLED", CurrentVersion, commandId, null, GetReport().ReceiptId);
        if (found || IsUpdateStaged) _ = TryApplyAsync();
        return found || IsUpdateStaged;
    }

    public async Task<bool> CheckForUpdatesAsync(long? commandId = null)
    {
        if (!await checkLock.WaitAsync(0)) return false;
        IsChecking = true;
        string? candidate = null;
        bool published = false;
        try
        {
            if (commandId.HasValue) SetReport("CHECKING", null, commandId);
            if (applyLock.CurrentCount == 0) return false;
            await Task.Run(() => UpdateCleanup.OnStartup(root, CurrentVersion));
            using var response = await http.GetAsync(ManifestUrl, stopping.Token);
            if (!response.IsSuccessStatusCode)
            {
                if (commandId.HasValue) throw new HttpRequestException($"Manifest HTTP {(int)response.StatusCode}");
                return false;
            }
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(stopping.Token));
            var manifest = document.RootElement;
            string version = manifest.GetProperty("version").GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+$"))
                throw new InvalidDataException("Manifest version is invalid.");
            if (Version.Parse(version) <= Version.Parse(CurrentVersion)) return false;
            if (IsFailedVersion(version))
            {
                if(commandId.HasValue)SetReport("ERROR",version,commandId,"Bu versiyaning oldingi o‘rnatilishi muvaffaqiyatsiz tugagan.");
                return false;
            }
            if (stagedVersion == version && staged != null) { SetReport("READY", version, commandId); return true; }
            SetReport("DOWNLOADING", version, commandId, receiptId:commandId.HasValue?null:Guid.NewGuid().ToString("N"), resetCommand:!commandId.HasValue);
            var file = manifest.GetProperty("client");
            string url = file.TryGetProperty("downloadUrl", out var download) ? download.GetString()! : file.GetProperty("url").GetString()!;
            string hash = file.GetProperty("sha256").GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("SHA256 is required.");
            var uri = new Uri(url);
            if (uri.Scheme != "https" && !(uri.IsLoopback && uri.Scheme == "http")) throw new InvalidDataException("HTTPS download required.");

            string? cached = await Task.Run(() => UpdateStorage.FindStaged(root,version,"client",hash));
            if (cached != null) { staged = cached; stagedVersion = version; SetReport("READY", version, commandId); return true; }

            IsDownloading = true;
            candidate = PackageManifest.ChildPath(root, "updates/staging/v" + version + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(candidate);
            string zip = Path.Combine(candidate, "download.zip");
            using (var downloadResponse = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, stopping.Token))
            {
                downloadResponse.EnsureSuccessStatusCode();
                await using var stream = await downloadResponse.Content.ReadAsStreamAsync(stopping.Token);
                await UpdateStorage.DownloadAsync(stream, zip, downloadResponse.Content.Headers.ContentLength, stopping.Token);
            }
            using (var stream = File.OpenRead(zip))
            {
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(hash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Downloaded package SHA256 mismatch.");
            }
            string extracted = Path.Combine(candidate, "package");
            UpdateStorage.CheckExtractionSpace(zip, extracted);
            ZipFile.ExtractToDirectory(zip, extracted);
            PackageManifest.Validate(extracted, version, "client");
            UpdateJournal.Write(Path.Combine(candidate,"download-receipt.json"),new {sha256=hash});
            File.Delete(zip);
            // Publish the staged state only after the whole package is validated.
            staged = extracted;
            stagedVersion = version;
            SetReport("READY", version, commandId);
            published = true;
            return true;
        }
        catch (Exception ex) { if (commandId.HasValue) SetReport("ERROR", null, commandId, ex.Message); Log(ex.Message); return false; }
        finally
        {
            // Only this failed attempt is disposable. Keep the last verified
            // package and all rollback/financial data.
            if (!published && candidate != null)
                UpdateCleanup.DeleteOwnedTree(root, Path.GetRelativePath(root, candidate), Log);
            IsChecking = false; IsDownloading = false; checkLock.Release();
        }
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
            IsChecking || IsDownloading || !await applyLock.WaitAsync(0)) return;
        string? cancel = null;
        try
        {
            // Third-party kiosk shells (RunPad and similar) intentionally stay
            // open while the PC is locked. Session/maintenance state is the
            // authority; treating the shell as a game postponed updates forever.
            if (!SafeOnUiThread(false, IdleSafety.IdleSeconds()))
            {
                if (sessionActive?.Invoke() == true) SetReport("WAITING_FOR_SESSION", stagedVersion);
                return;
            }
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
            var app = System.Windows.Application.Current;
            app.Dispatcher.Invoke(() =>
            {
                if (!IdleSafety.CanApply(sessionActive?.Invoke() ?? true, maintenance?.Invoke() ?? true,
                    IdleSafety.IdleSeconds(), false, idleSeconds))
                    throw new InvalidOperationException("Computer became busy; update postponed.");
                WatchdogService.PrepareForUpdate();
                SetReport("INSTALLING", stagedVersion);
                File.WriteAllText(plan.CommitFile, stagedVersion);
                cancel = null;
                app.Shutdown(0);
            });
        }
        catch (Exception ex) { nextApplyAttempt = DateTime.UtcNow.AddSeconds(60); SetReport("ERROR", stagedVersion, null, ex.Message); Log(ex.Message); }
        finally
        {
            if (cancel != null) try { File.WriteAllText(cancel, "cancel"); } catch { }
            applyLock.Release();
        }
    }

    private static void Log(string message) => Debug.WriteLine("[AutoUpdate] " + message);
}
