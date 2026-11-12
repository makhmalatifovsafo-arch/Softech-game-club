using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Softech.Updates;

namespace SoftechUpdater;

public static class Program
{
    private static string? logFile;
    private static readonly JsonSerializerOptions Json = PackageManifest.JsonOptions;

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 3 && args[0] == "--cleanup")
            {
                UpdateCleanup.OnStartup(Path.GetFullPath(args[1]), args[2], Log);
                return 0;
            }
            if (args.Length == 1 && args[0] == "--probe-idle")
            {
                Console.WriteLine(JsonSerializer.Serialize(new { idleSeconds = IdleSafety.IdleSeconds() }));
                return 0;
            }
            if (args.Length == 3 && args[0] == "--extract")
            {
                // .NET rejects ZIP traversal; package validation also rejects reparse points.
                ZipFile.ExtractToDirectory(args[1], args[2], overwriteFiles: false);
                return 0;
            }
            if (args.Length != 2 || args[0] != "--plan") return 2;
            var plan = JsonSerializer.Deserialize<UpdatePlan>(File.ReadAllText(args[1]), Json)
                ?? throw new InvalidDataException("Missing update plan.");
            return plan.RestartOnly ? await RestartOnly(plan) : await Apply(plan);
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            return 1;
        }
    }

    private static async Task<int> Apply(UpdatePlan plan)
    {
        string target = Path.GetFullPath(plan.Target);
        string source = Path.GetFullPath(plan.Source);
        if (!Directory.Exists(target) || source.Equals(target, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Invalid source/target.");
        if (plan.Kind is not ("client" or "server") || plan.ParentPids.Length == 0)
            throw new InvalidDataException("Invalid application update plan.");
        Directory.CreateDirectory(Path.Combine(target, "logs"));
        logFile = Path.Combine(target, "logs", "updater.log");
        string transaction = Path.Combine(target, ".ota", Guid.NewGuid().ToString("N"));
        string prepared = Path.Combine(transaction, "prepared");
        string backup = Path.Combine(transaction, "backup");
        var applied = new List<string>();
        var originals = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var databases = new Dictionary<string, string>();
        Process? restarted = null;
        bool committed = false;
        bool healthy = false;
        bool restored = false;
        Directory.CreateDirectory(Path.Combine(target, ".ota"));
        FileStream transactionLock;
        try
        {
            transactionLock = new FileStream(Path.Combine(target, ".ota", "update.lock"),
                FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException) { return 3; } // Another transaction still owns preparation/health/rollback.
        using var exclusiveTransaction = transactionLock;
        Directory.CreateDirectory(transaction);
        try
        {
            var package = PackageManifest.Validate(source, plan.Version, plan.Kind);
            var files = package.Files.Keys.Append("update-package.json").ToArray();
            foreach (string relative in files)
            {
                string destination = PackageManifest.ChildPath(target, relative);
                string staged = PackageManifest.ChildPath(prepared, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
                File.Copy(PackageManifest.ChildPath(source, relative), staged, true);
                if (File.Exists(destination))
                {
                    string old = PackageManifest.ChildPath(backup, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(old)!);
                    File.Copy(destination, old, true);
                    originals.Add(relative);
                }
            }
            // All slow copying and access checks finish while the application still runs.
            File.WriteAllText(plan.ReadyFile, JsonSerializer.Serialize(new { version = plan.Version, pid = Environment.ProcessId }));
            var deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(plan.TimeoutSeconds, 10, 180));
            while (!File.Exists(plan.CommitFile))
            {
                if (File.Exists(plan.CancelFile) || DateTime.UtcNow > deadline) return 3;
                await Task.Delay(50);
            }
            foreach (int pid in plan.ParentPids.Distinct())
            {
                try
                {
                    using var parent = Process.GetProcessById(pid);
                    await parent.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
                }
                catch (ArgumentException) { } // The exact parent already exited.
            }
            // No process-name scans, force-kills or runas/UAC prompts.
            // Snapshot databases after parent exit so a failing schema migration can roll back.
            if (plan.Kind == "server")
            {
                var candidates = Directory.GetFiles(target, "*.db*").AsEnumerable();
                if (Directory.Exists(Path.Combine(target, "data")))
                    candidates = candidates.Concat(Directory.GetFiles(Path.Combine(target, "data"), "*.db*", SearchOption.AllDirectories));
                foreach (var db in candidates)
                {
                    string relative = Path.GetRelativePath(target, db);
                    // Independent recovery snapshots are not live databases and must
                    // never be copied again or rolled back with application files.
                    if (relative.Replace('\\', '/').StartsWith("data/backups/", StringComparison.OrdinalIgnoreCase)) continue;
                    string snapshot = PackageManifest.ChildPath(Path.Combine(transaction, "databases"), relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(snapshot)!);
                    File.Copy(db, snapshot, true);
                    databases[db] = snapshot;
                }
            }
            committed = true;
            var downtime = Stopwatch.StartNew();
            foreach (string relative in files)
            {
                string destination = PackageManifest.ChildPath(target, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                applied.Add(relative);
                File.Move(PackageManifest.ChildPath(prepared, relative), destination, true);
            }
            restarted = Launch(plan);
            Log($"v{plan.Version}: files switched and process started in {downtime.ElapsedMilliseconds} ms.");
            if (restarted == null) throw new IOException("Could not restart application.");

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            bool ready = false;
            var healthDeadline = DateTime.UtcNow.AddSeconds(30);
            var stableSince = DateTime.UtcNow;
            while (DateTime.UtcNow < healthDeadline)
            {
                if (restarted.HasExited) throw new IOException("Updated application exited during health check.");
                if (plan.Kind == "client") ready = File.Exists(plan.HealthFile);
                else if (!string.IsNullOrWhiteSpace(plan.HealthUrl))
                {
                    try
                    {
                        var data = await http.GetStringAsync(plan.HealthUrl);
                        using var health = JsonDocument.Parse(data);
                        ready = health.RootElement.GetProperty("version").GetString() == plan.Version;
                    }
                    catch { ready = false; }
                }
                if (!ready) stableSince = DateTime.UtcNow;
                if (ready && DateTime.UtcNow - stableSince >= TimeSpan.FromSeconds(10)) { healthy = true; break; }
                await Task.Delay(100);
            }
            if (!healthy) throw new IOException("Updated application did not become healthy.");
            File.WriteAllText(Path.Combine(target, "updates-last-success.json"),
                JsonSerializer.Serialize(new { version = plan.Version, at = DateTimeOffset.UtcNow }));
            Log("Update health verified.");
            // Cleanup failure must never turn a healthy update into a rollback.
            try { UpdateCleanup.AfterSuccess(target, plan.Version, transaction, Log); }
            catch (Exception cleanupError) { Log("Cleanup deferred: " + cleanupError.Message); }
            return 0;
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            if (!committed)
            {
                File.WriteAllText(plan.ReadyFile + ".error", ex.Message);
                return 4; // Running application has not been disturbed.
            }
            // Only stop the process created by this transaction, never unrelated applications.
            if (restarted != null && !restarted.HasExited)
            {
                restarted.Kill(entireProcessTree: true);
                await restarted.WaitForExitAsync();
            }
            foreach (string relative in applied.AsEnumerable().Reverse())
            {
                string destination = PackageManifest.ChildPath(target, relative);
                if (originals.Contains(relative))
                    File.Copy(PackageManifest.ChildPath(backup, relative), destination, true);
                else if (File.Exists(destination)) File.Delete(destination);
            }
            foreach (var db in databases.Keys.Where(file => file.EndsWith(".db", StringComparison.OrdinalIgnoreCase)))
                foreach (var suffix in new[] { "-wal", "-shm" })
                    if (File.Exists(db + suffix)) File.Delete(db + suffix);
            foreach (var db in databases) File.Copy(db.Value, db.Key, true);
            restored = true;
            File.WriteAllText(Path.Combine(target, "updates-failed-version.json"),
                JsonSerializer.Serialize(new { version = plan.Version, error = ex.Message, at = DateTimeOffset.UtcNow }));
            // Old client must not retain the new readiness marker.
            if (File.Exists(plan.HealthFile)) File.Delete(plan.HealthFile);
            Launch(plan);
            Log("Previous application files restored and restarted.");
            return 5;
        }
        finally
        {
            restarted?.Dispose();
            // Aborted preparation and completed rollback do not need duplicate
            // snapshots. An interrupted/failed rollback keeps recovery evidence.
            if (!committed || restored)
                UpdateCleanup.DeleteOwnedTree(target, ".ota/" + Path.GetFileName(transaction), Log);
            foreach (string file in new[] { plan.ReadyFile, plan.CommitFile, plan.CancelFile })
                try { if (File.Exists(file)) File.Delete(file); } catch { }
        }
    }

    private static async Task<int> RestartOnly(UpdatePlan plan)
    {
        string target = Path.GetFullPath(plan.Target);
        if (plan.Kind != "server" || !Directory.Exists(target) || plan.ParentPids.Length == 0 || plan.ParentPids.Any(pid => pid <= 0))
            throw new InvalidDataException("Invalid restart plan.");
        string relativeExe = Path.GetRelativePath(target, plan.RestartExecutable);
        if (!File.Exists(PackageManifest.ChildPath(target, relativeExe))) throw new FileNotFoundException("Restart application missing.");
        Directory.CreateDirectory(Path.Combine(target, ".ota"));
        using var transactionLock = new FileStream(Path.Combine(target, ".ota", "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        try
        {
            File.WriteAllText(plan.ReadyFile, "ready");
            var deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(plan.TimeoutSeconds, 10, 180));
            while (!File.Exists(plan.CommitFile))
            {
                if (File.Exists(plan.CancelFile) || DateTime.UtcNow > deadline) return 3;
                await Task.Delay(50);
            }
            foreach (int pid in plan.ParentPids.Distinct())
            {
                try { using var parent = Process.GetProcessById(pid); await parent.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30)); }
                catch (ArgumentException) { }
            }
            using var restarted = Launch(plan);
            if (restarted == null) throw new IOException("Server could not restart.");
            return 0;
        }
        catch (Exception error) { File.WriteAllText(plan.ReadyFile + ".error", error.Message); return 4; }
        finally
        {
            foreach (string file in new[] { plan.ReadyFile, plan.CommitFile, plan.CancelFile })
                try { if (File.Exists(file)) File.Delete(file); } catch { }
        }
    }

    private static Process? Launch(UpdatePlan plan)
    {
        var info = new ProcessStartInfo
        {
            FileName = plan.RestartExecutable, WorkingDirectory = plan.Target,
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
        };
        foreach (string arg in plan.RestartArguments) info.ArgumentList.Add(arg);
        if (plan.Kind == "client")
        {
            info.ArgumentList.Add("--update-health");
            info.ArgumentList.Add(plan.HealthFile);
        }
        return Process.Start(info);
    }

    private static void Log(string message)
    {
        try { if (logFile != null) File.AppendAllText(logFile, $"[{DateTimeOffset.Now:O}] {message}{Environment.NewLine}"); }
        catch { }
    }
}
