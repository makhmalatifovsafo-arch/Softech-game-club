using Softech.Updates;
if (args.Length == 4 && args[0] == "--validate")
{
    var package = PackageManifest.Validate(args[1], args[2], args[3]);
    Console.WriteLine($"Validated {package.Files.Count} managed files.");
    return;
}
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
Check(IdleSafety.CanApply(false, false, 10, false), "Idle kiosk should update.");
Check(!IdleSafety.CanApply(true, false, 100, false), "Live session must block.");
Check(!IdleSafety.CanApply(false, true, 100, false), "Maintenance must block.");
Check(!IdleSafety.CanApply(false, false, 9.999, false), "Mouse or keyboard activity must block.");
Check(!IdleSafety.CanApply(false, false, 100, true), "Open/minimized/background user app must block.");
Check(!IdleSafety.CanApply(false, false, -1, false), "Unknown input must block.");
foreach (string local in new[] { "config.json", ".env", ".env.local", "netcafe.db", "netcafe.db-wal", "data/license.sig", "updates/foo", ".ota/backup" })
    Check(PackageManifest.Preserved(local), "Must preserve " + local);
foreach (string invalid in new[] { "../outside", @"..\outside", @"C:\outside", "safe:stream" })
{
    bool rejected = false;
    try { PackageManifest.ChildPath(Path.GetTempPath(), invalid); } catch (InvalidDataException) { rejected = true; }
    Check(rejected, "Must reject " + invalid);
}
Console.WriteLine("Native idle policy and package path checks passed.");

string cleanupRoot = Path.GetFullPath(Path.Combine(".test-output", "retention-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(cleanupRoot);
Directory.CreateDirectory(Path.Combine(cleanupRoot, "data"));
File.WriteAllText(Path.Combine(cleanupRoot, "config.json"), "settings");
File.WriteAllText(Path.Combine(cleanupRoot, "netcafe.db"), "live database");
File.WriteAllText(Path.Combine(cleanupRoot, "data", "license.sig"), "license");
string future = Path.Combine(cleanupRoot, "updates", "staging", "v99.0.0-" + Guid.NewGuid());
Directory.CreateDirectory(future);File.WriteAllText(Path.Combine(future, "payload"), "pending future update");
string unknown = Path.Combine(cleanupRoot, ".ota", "user-notes");
Directory.CreateDirectory(unknown);File.WriteAllText(Path.Combine(unknown,"note"),"keep");
for (int i = 1; i <= 10; i++)
{
    string transaction = Path.Combine(cleanupRoot, ".ota", Guid.NewGuid().ToString("N"));
    foreach (string part in new[] { "backup", "prepared", "databases" })
    {
        Directory.CreateDirectory(Path.Combine(transaction, part));
        File.WriteAllText(Path.Combine(transaction, part, "file"), "v" + i);
    }
    string candidate = Path.Combine(cleanupRoot, "updates", "staging", "v1.0." + i + "-" + Guid.NewGuid());
    Directory.CreateDirectory(candidate);File.WriteAllText(Path.Combine(candidate,"payload"),"package");
    UpdateCleanup.AfterSuccess(cleanupRoot, "1.0." + i, transaction);
    Check(Directory.GetDirectories(Path.Combine(cleanupRoot,".ota")).Count(p=>Guid.TryParseExact(Path.GetFileName(p),"N",out _)) == 1, "Keep only one rollback transaction after 10 releases");
    Check(Directory.Exists(Path.Combine(transaction,"backup")),"Keep latest backup");
    Check(Directory.Exists(Path.Combine(transaction,"databases")),"Keep latest rollback database snapshot");
    Check(!Directory.Exists(Path.Combine(transaction,"prepared")),"Remove prepared duplicate");
    Check(!Directory.Exists(candidate),"Remove installed staging package");
}
string lockedCandidate = Path.Combine(cleanupRoot,"updates","staging","v1.0.1-"+Guid.NewGuid());
Directory.CreateDirectory(lockedCandidate);
using (var active = new FileStream(Path.Combine(cleanupRoot,".ota","update.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None))
{
    UpdateCleanup.OnStartup(cleanupRoot,"1.0.10");
    Check(Directory.Exists(lockedCandidate),"Never clean during an active transaction");
}
UpdateCleanup.OnStartup(cleanupRoot,"1.0.10");
Check(!Directory.Exists(lockedCandidate),"Retry cleanup after helper releases lock");
foreach (var (version, sameTarget, shouldRemove) in new[] { ("1.0.9", true, true), ("99.0.0", true, false), ("1.0.9", false, false) })
{
    string handover = Path.Combine(cleanupRoot,"updates","staging","handover-"+Guid.NewGuid());
    Directory.CreateDirectory(handover);
    File.WriteAllText(Path.Combine(handover,"plan.json"), System.Text.Json.JsonSerializer.Serialize(
        new UpdatePlan { Target = sameTarget ? cleanupRoot : Path.Combine(cleanupRoot,"other"), Version = version }));
    UpdateCleanup.OnStartup(cleanupRoot,"1.0.10");
    Check(Directory.Exists(handover) != shouldRemove,"Clean only obsolete handovers belonging to this installation");
}
Check(Directory.Exists(future),"Preserve staged future release");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"config.json"))=="settings","Preserve configuration");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"netcafe.db"))=="live database","Preserve live database");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"data","license.sig"))=="license","Preserve license");
Check(Directory.Exists(unknown),"Do not delete unknown user directories");
UpdateCleanup.DeleteOwnedTree(cleanupRoot,"../");
Check(Directory.Exists(cleanupRoot),"Reject cleanup outside installation");
Console.WriteLine("PASS: ten releases retain one rollback backup; obsolete staging removed; active transaction, future release and user data preserved");
