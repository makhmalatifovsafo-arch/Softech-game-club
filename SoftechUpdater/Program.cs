using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Softech.Updates;

namespace SoftechUpdater;

public static class Program
{
    private static string? logFile;
    private static readonly JsonSerializerOptions Json = PackageManifest.JsonOptions;
    private static async Task WaitForParent(int pid)
    {
        try {
            using var parent=Process.GetProcessById(pid);
            await parent.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
        }catch(ArgumentException) { }
        catch(System.ComponentModel.Win32Exception error)when(error.NativeErrorCode==5) {
            // LocalService may not obtain a SYNCHRONIZE handle to an interactive
            // cashier process. Observe its disappearance; never kill or elevate.
            var deadline=DateTime.UtcNow.AddSeconds(30);
            while(DateTime.UtcNow<deadline){
                try{using var parent=Process.GetProcessById(pid);}catch(ArgumentException){return;}
                await Task.Delay(100);
            }
            throw new IOException("Cashier process did not exit; update cancelled.");
        }
    }

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if(args.Length==5&&args[0]=="--find-staged") {
                Console.WriteLine(UpdateStorage.FindStaged(Path.GetFullPath(args[1]),args[2],args[3],args[4])??"");
                return 0;
            }
            if(args.Length==2&&args[0]=="--recover")return UpdateJournal.Recover(Path.GetFullPath(args[1]),Log)?0:3;
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
                UpdateStorage.CheckExtractionSpace(args[1], args[2]);
                ZipFile.ExtractToDirectory(args[1], args[2], overwriteFiles: false);
                return 0;
            }
            if (args.Length != 2 || args[0] != "--plan") return 2;
            var plan = JsonSerializer.Deserialize<UpdatePlan>(File.ReadAllText(args[1]), Json)
                ?? throw new InvalidDataException("Missing update plan.");
            return plan.RestartOnly || plan.RecoveryOnly ? await RestartOnly(plan) : await Apply(plan);
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
        FileStream? serverGuard=null;
        bool committed = false;
        bool healthy = false;
        bool restored = false;
        var journal=new UpdateJournal {Version=plan.Version,Kind=plan.Kind,Token=Path.GetFileName(transaction)};
        string helperRelative=Path.GetRelativePath(target,Environment.ProcessPath??"").Replace('\\','/');
        if(helperRelative.StartsWith("updates/staging/handover-",StringComparison.OrdinalIgnoreCase))journal.HelperRelativePath=helperRelative;
        Directory.CreateDirectory(Path.Combine(target, ".ota"));
        FileStream transactionLock;
        try
        {
            transactionLock = new FileStream(Path.Combine(target, ".ota", "update.lock"),
                FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException) { return 3; } // Another transaction still owns preparation/health/rollback.
        using var exclusiveTransaction = transactionLock;
        if(UpdateJournal.HasPending(target))throw new IOException("An interrupted update requires startup recovery first.");
        Directory.CreateDirectory(transaction);
        try
        {
            var package = PackageManifest.Validate(source, plan.Version, plan.Kind);
            var files = package.Files.Keys.Append("update-package.json").ToArray();
            journal.Files=files;
            if(plan.Kind=="server") {
                if(!Uri.TryCreate(plan.HealthUrl,UriKind.Absolute,out var healthUri)||!healthUri.IsLoopback||healthUri.Scheme!="http")throw new InvalidDataException("Server health URL must be local HTTP.");
                journal.Port=healthUri.Port;
            }
            foreach (string relative in files)
            {
                string destination = PackageManifest.ChildPath(target, relative);
                string staged = PackageManifest.ChildPath(prepared, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
                UpdateStorage.EnsureFreeSpace(target, new FileInfo(PackageManifest.ChildPath(source,relative)).Length);
                File.Copy(PackageManifest.ChildPath(source, relative), staged, true);
                UpdateJournal.Flush(staged);
                if (File.Exists(destination))
                {
                    string old = PackageManifest.ChildPath(backup, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(old)!);
                    UpdateStorage.EnsureFreeSpace(target, new FileInfo(destination).Length);
                    File.Copy(destination, old, true);
                    UpdateJournal.Flush(old);
                    originals.Add(relative);
                    journal.Originals[relative]=UpdateJournal.Hash(old);
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
                await WaitForParent(pid);
            }
            // No process-name scans, force-kills or runas/UAC prompts.
            // Snapshot databases after parent exit so a failing schema migration can roll back.
            if(UpdateJournal.PortBusy(journal.Port))throw new IOException("Server port is still busy; application files were not switched.");
            if (plan.Kind == "server")
            {
                serverGuard=UpdateJournal.AcquireServerLock(target);
                var candidates = Directory.GetFiles(target, "*.db*").AsEnumerable();
                if (Directory.Exists(Path.Combine(target, "data")))
                    candidates = candidates.Concat(Directory.GetFiles(Path.Combine(target, "data"), "*.db*", SearchOption.AllDirectories));
                foreach (var db in candidates)
                {
                    string relative = Path.GetRelativePath(target, db);
                    // Independent recovery snapshots are not live databases and must
                    // never be copied again or rolled back with application files.
                    if (relative.Replace('\\', '/').StartsWith("data/backups/", StringComparison.OrdinalIgnoreCase)) continue;
                    if (relative.Replace('\\', '/').StartsWith("data/server-instance.db", StringComparison.OrdinalIgnoreCase)) continue;
                    if(!new[]{".db",".db-wal",".db-shm",".db-journal"}.Any(suffix=>relative.EndsWith(suffix,StringComparison.OrdinalIgnoreCase)))continue;
                    string snapshot = PackageManifest.ChildPath(Path.Combine(transaction, "databases"), relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(snapshot)!);
                    UpdateStorage.EnsureFreeSpace(target, new FileInfo(db).Length);
                    File.Copy(db, snapshot, true);
                    UpdateJournal.Flush(snapshot);
                    databases[db] = snapshot;
                    journal.Databases[relative]=UpdateJournal.Hash(snapshot);
                }
            }
            journal.Save(transaction); // Durable intent precedes the first replacement.
            committed = true;
            var downtime = Stopwatch.StartNew();
            foreach (string relative in files)
            {
                string destination = PackageManifest.ChildPath(target, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                applied.Add(relative);
                File.Move(PackageManifest.ChildPath(prepared, relative), destination, true);
            }
            serverGuard?.Dispose();serverGuard=null;
            restarted = Launch(plan,plan.Kind=="server"?journal.Token:null);
            Log($"v{plan.Version}: files switched and process started in {downtime.ElapsedMilliseconds} ms.");
            if (restarted == null) throw new IOException("Could not restart application.");
            journal.RestartedPid=restarted.Id;
            journal.RestartedStartTicks=restarted.StartTime.ToUniversalTime().Ticks;
            journal.RestartedExecutable=Path.GetFullPath(plan.RestartExecutable);
            journal.Save(transaction);

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            bool ready = false;
            // Server startup verifies and snapshots the database before migrations.
            // Allow the launcher's 90-second readiness window plus stability checks.
            var healthDeadline = DateTime.UtcNow.AddSeconds(plan.Kind == "server" ? 120 : 30);
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
                        var root=health.RootElement;
                        ready = root.GetProperty("app").GetString()=="NetCafeServer"&&root.GetProperty("status").GetString()=="ok"&&
                            root.GetProperty("version").GetString()==plan.Version&&root.GetProperty("updateToken").GetString()==journal.Token&&
                            root.GetProperty("updatePending").GetBoolean();
                    }
                    catch { ready = false; }
                }
                if (!ready) stableSince = DateTime.UtcNow;
                if (ready && DateTime.UtcNow - stableSince >= TimeSpan.FromSeconds(10)) { healthy = true; break; }
                await Task.Delay(100);
            }
            if (!healthy) throw new IOException("Updated application did not become healthy.");
            journal.Phase="ACCEPTED";journal.Save(transaction);
            if(plan.Kind=="server")UpdateJournal.Write(Path.Combine(transaction,"approved.json"),new{token=journal.Token});
            UpdateJournal.Write(Path.Combine(target, "updates-last-success.json"),new { version = plan.Version, at = DateTimeOffset.UtcNow });
            Log("Update health verified.");
            // Cleanup failure must never turn a healthy update into a rollback.
            try { UpdateCleanup.AfterSuccess(target, plan.Version, transaction, Log); }
            catch (Exception cleanupError) { Log("Cleanup deferred: " + cleanupError.Message); }
            return 0;
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            if(journal.Phase=="ACCEPTED") { Log("Update accepted; activation/cleanup retry required. Database rollback prohibited."); return 6; }
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
            var stopDeadline=DateTime.UtcNow.AddSeconds(10);
            while(UpdateJournal.PortBusy(journal.Port)&&DateTime.UtcNow<stopDeadline)await Task.Delay(100);
            if(UpdateJournal.PortBusy(journal.Port))throw new IOException("Rollback postponed: server still owns its port. Recovery files preserved.");
            if(plan.Kind=="server")serverGuard??=UpdateJournal.AcquireServerLock(target);
            journal.Restore(target,transaction);
            restored = true;
            serverGuard?.Dispose();serverGuard=null;
            // Old client must not retain the new readiness marker.
            if (File.Exists(plan.HealthFile)) File.Delete(plan.HealthFile);
            Launch(plan);
            Log("Previous application files restored and restarted.");
            return 5;
        }
        finally
        {
            serverGuard?.Dispose();
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
        Directory.CreateDirectory(Path.Combine(target,"logs"));logFile=Path.Combine(target,"logs","updater.log");
        Directory.CreateDirectory(Path.Combine(target, ".ota"));
        using var transactionLock = new FileStream(Path.Combine(target, ".ota", "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if(!plan.RecoveryOnly&&UpdateJournal.HasPending(target))throw new IOException("An interrupted update requires startup recovery first.");
        if(!Uri.TryCreate(plan.HealthUrl,UriKind.Absolute,out var healthUri)||!healthUri.IsLoopback||healthUri.Scheme!="http")throw new InvalidDataException("Server health URL must be local HTTP.");
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
                await WaitForParent(pid);
            }
            if(plan.RecoveryOnly) {
                transactionLock.Dispose();
                if(!UpdateJournal.Recover(target,Log))throw new IOException("Recovery is owned by another updater.");
                using var package=JsonDocument.Parse(File.ReadAllText(Path.Combine(target,"package.json")));
                plan.Version=package.RootElement.GetProperty("version").GetString()??"";
            }
            using var restarted = Launch(plan);
            if (restarted == null) throw new IOException("Server could not restart.");
            using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(1)};
            var healthDeadline=DateTime.UtcNow.AddSeconds(120);
            while(DateTime.UtcNow<healthDeadline) {
                if(restarted.HasExited)throw new IOException("Restarted server exited before readiness.");
                try {
                    using var health=JsonDocument.Parse(await http.GetStringAsync(plan.HealthUrl));
                    var root=health.RootElement;
                    if(root.GetProperty("app").GetString()=="NetCafeServer"&&root.GetProperty("status").GetString()=="ok"&&root.GetProperty("version").GetString()==plan.Version)return 0;
                }catch(Exception error)when(error is HttpRequestException or JsonException or TaskCanceledException or InvalidOperationException or KeyNotFoundException){}
                await Task.Delay(100);
            }
            throw new IOException("Restarted server readiness timed out; process left running for diagnostics.");
        }
        catch (Exception error) {
            Log(error.ToString());File.WriteAllText(plan.ReadyFile + ".error", error.Message);
            if(plan.RecoveryOnly)try{Launch(plan,recoveryFailed:true);}catch(Exception launchError){Log(launchError.ToString());}
            return 4;
        }
        finally
        {
            foreach (string file in new[] { plan.ReadyFile, plan.CommitFile, plan.CancelFile })
                try { if (File.Exists(file)) File.Delete(file); } catch { }
        }
    }

    private static Process? Launch(UpdatePlan plan,string? updateToken=null,bool recoveryFailed=false)
    {
        var info = new ProcessStartInfo
        {
            FileName = plan.RestartExecutable, WorkingDirectory = plan.Target,
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
        };
        foreach (string arg in plan.RestartArguments) info.ArgumentList.Add(arg);
        info.Environment.Remove("SOFTECH_UPDATE_TOKEN");
        info.Environment.Remove("SOFTECH_UPDATER_RESTART");
        info.Environment.Remove("SOFTECH_RECOVERY_FAILED");
        if(recoveryFailed)info.Environment["SOFTECH_RECOVERY_FAILED"]="1";
        if(plan.RestartOnly)info.Environment["SOFTECH_UPDATER_RESTART"]="1";
        if(updateToken!=null)info.Environment["SOFTECH_UPDATE_TOKEN"]=updateToken;
        if (plan.Kind == "client")
        {
            info.ArgumentList.Add("--update-health");
            info.ArgumentList.Add(plan.HealthFile);
        }
        return Process.Start(info);
    }

    private static void Log(string message)
    {
        if (logFile != null) BoundedLog.Append(logFile, message);
    }
}
