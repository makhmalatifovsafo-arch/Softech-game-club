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
foreach (string local in new[] { ".service/SoftechService.exe", ".service/private/control.key", "config.json", "config.json.last-good", "config.json.corrupt-example.bak", ".env", ".env.local", "netcafe.db", "netcafe.db-wal", "data/license.sig", "updates/foo", ".ota/backup" })
    Check(PackageManifest.Preserved(local), "Must preserve " + local);
foreach (string invalid in new[] { "../outside", @"..\outside", @"C:\outside", "safe:stream" })
{
    bool rejected = false;
    try { PackageManifest.ChildPath(Path.GetTempPath(), invalid); } catch (InvalidDataException) { rejected = true; }
    Check(rejected, "Must reject " + invalid);
}
Console.WriteLine("Native idle policy and package path checks passed.");
bool lowSpace=false;
try { UpdateStorage.EnsureFreeSpace(".",1024,()=>UpdateStorage.ReserveBytes+1023); }
catch(IOException){lowSpace=true;}
Check(lowSpace,"Optional update must preserve the free-space reserve");
UpdateStorage.EnsureFreeSpace(".",1024,()=>UpdateStorage.ReserveBytes+1024);
string storageRoot=Path.GetFullPath(Path.Combine(".test-output","storage-"+Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(storageRoot);
string boundedLog=Path.Combine(storageRoot,"updater.log");
for(int i=0;i<400;i++)BoundedLog.Append(boundedLog,new string('x',16000));
Check(new FileInfo(boundedLog).Length<=BoundedLog.MaxBytes,"Current updater log exceeded its budget");
Check(new FileInfo(boundedLog+".previous").Length<=BoundedLog.MaxBytes,"Rotated updater log exceeded its budget");
Check(Directory.GetFiles(storageRoot).Length==2,"Log rotations accumulated");
File.WriteAllText(boundedLog,new string('x',(int)BoundedLog.MaxBytes+1024)+"latest-error");
BoundedLog.Append(boundedLog,"after upgrade");
Check(new FileInfo(boundedLog+".previous").Length<=BoundedLog.MaxBytes&&File.ReadAllText(boundedLog+".previous").EndsWith("latest-error"),"Legacy oversized log lost its tail or remained unbounded");
await UpdateStorage.DownloadAsync(new MemoryStream(new byte[4096]),Path.Combine(storageRoot,"valid.zip"),4096,CancellationToken.None);
bool truncated=false;
try { await UpdateStorage.DownloadAsync(new MemoryStream(new byte[100]),Path.Combine(storageRoot,"truncated.zip"),4096,CancellationToken.None); }
catch(InvalidDataException){truncated=true;}
Check(truncated,"Truncated download was accepted");
bool oversized=false;
string oversizedPath=Path.Combine(storageRoot,"oversized.zip");
try { await UpdateStorage.DownloadAsync(new MemoryStream(),oversizedPath,UpdateStorage.MaxDownloadBytes+1,CancellationToken.None); }
catch(InvalidDataException){oversized=true;}
Check(oversized&&!File.Exists(oversizedPath),"Oversized download was written to disk");
Console.WriteLine("PASS bounded logs, reserved free space, complete download and oversized/truncated rejection");
string cacheRoot=Path.Combine(storageRoot,"cache-install");
string cacheCandidate=Path.Combine(cacheRoot,"updates","staging","v99.0.0-"+Guid.NewGuid());
string cacheSource=Path.Combine(cacheCandidate,"package");Directory.CreateDirectory(cacheSource);
var cacheManifest=new PackageManifest{Version="99.0.0",Kind="client"};
foreach(string entry in new[]{"NetCafeClient.exe","SoftechUpdater.exe"}) {
    File.WriteAllText(Path.Combine(cacheSource,entry),"fixture");
    cacheManifest.Files[entry]=UpdateJournal.Hash(Path.Combine(cacheSource,entry));
}
UpdateJournal.Write(Path.Combine(cacheSource,"update-package.json"),cacheManifest);
UpdateJournal.Write(Path.Combine(cacheCandidate,"download-receipt.json"),new{sha256=new string('a',64)});
Check(UpdateStorage.FindStaged(cacheRoot,"99.0.0","client",new string('a',64))==cacheSource,"Valid cached download was not reused");
Check(UpdateStorage.FindStaged(cacheRoot,"99.0.0","client",new string('b',64))==null,"Different release archive reused old cache");
File.WriteAllText(Path.Combine(cacheSource,"NetCafeClient.exe"),"corrupted");
Check(UpdateStorage.FindStaged(cacheRoot,"99.0.0","client",new string('a',64))==null,"Damaged cached executable accepted");
Console.WriteLine("PASS restart reuses only a complete package matching archive hash and every file hash");
string extractionRoot = Path.GetFullPath(Path.Combine(".test-output", "safe-install-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(extractionRoot);
string extractionZip = Path.Combine(extractionRoot, "package.zip");
string installTarget = Path.Combine(extractionRoot,"installed");
Directory.CreateDirectory(installTarget);
foreach (string name in new[] { "netcafe.db", "netcafe.db-wal", "config.json", "config.json.last-good", "license.sig" }) File.WriteAllText(Path.Combine(installTarget,name),"original");
using (var zip = System.IO.Compression.ZipFile.Open(extractionZip,System.IO.Compression.ZipArchiveMode.Create))
{
    foreach (string name in new[] { "netcafe.db", "netcafe.db-wal", "config.json", "config.json.last-good", "license.sig", "data/backups/precious.db", "app.js" })
    { using var writer = new StreamWriter(zip.CreateEntry(name).Open()); writer.Write("package contents"); }
}
SafePackageExtraction.Extract(extractionZip,installTarget);
foreach (string name in new[] { "netcafe.db", "netcafe.db-wal", "config.json", "config.json.last-good", "license.sig" }) Check(File.ReadAllText(Path.Combine(installTarget,name))=="original","Installer overwrote local data: "+name);
Check(File.ReadAllText(Path.Combine(installTarget,"app.js"))=="package contents","Application was not upgraded");
Check(!File.Exists(Path.Combine(installTarget,"data/backups/precious.db")),"Package injected database backup");
Console.WriteLine("PASS reinstall replaces application files without overwriting database, WAL, config, license or backups");

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
string cancelledHandover=Path.Combine(cleanupRoot,"updates","staging","handover-"+Guid.NewGuid());
Directory.CreateDirectory(cancelledHandover);
string cancelPath=Path.Combine(cancelledHandover,"cancel");File.WriteAllText(cancelPath,"cancel");
UpdateJournal.Write(Path.Combine(cancelledHandover,"plan.json"),new UpdatePlan {Target=cleanupRoot,Version="99.0.0",CancelFile=cancelPath});
using(var guard=new FileStream(Path.Combine(cleanupRoot,".ota","update.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) {
    UpdateCleanup.OnStartup(cleanupRoot,"1.0.10");
    Check(Directory.Exists(cancelledHandover),"Active helper files were deleted");
}
UpdateCleanup.OnStartup(cleanupRoot,"1.0.10");
Check(!Directory.Exists(cancelledHandover),"Cancelled future-version handover leaked files");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"config.json"))=="settings","Preserve configuration");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"netcafe.db"))=="live database","Preserve live database");
Check(File.ReadAllText(Path.Combine(cleanupRoot,"data","license.sig"))=="license","Preserve license");
Check(Directory.Exists(unknown),"Do not delete unknown user directories");
UpdateCleanup.DeleteOwnedTree(cleanupRoot,"../");
Check(Directory.Exists(cleanupRoot),"Reject cleanup outside installation");
Console.WriteLine("PASS: ten releases retain one rollback backup; obsolete staging removed; active transaction, future release and user data preserved");

foreach(string scenario in new[]{"interrupted","corrupt-backup","port-busy","accepted"}) {
    string root=Path.GetFullPath(Path.Combine(".test-output","journal-"+Guid.NewGuid().ToString("N")));
    string token=Guid.NewGuid().ToString("N"),transaction=Path.Combine(root,".ota",token);
    Directory.CreateDirectory(Path.Combine(transaction,"backup"));Directory.CreateDirectory(Path.Combine(transaction,"databases"));
    File.WriteAllText(Path.Combine(root,"app.js"),"half-installed");File.WriteAllText(Path.Combine(root,"new.js"),"new only");
    File.WriteAllText(Path.Combine(root,"config.json"),"local configuration");File.WriteAllText(Path.Combine(root,"netcafe.db"),"new schema");
    File.WriteAllText(Path.Combine(transaction,"backup","app.js"),"old code");File.WriteAllText(Path.Combine(transaction,"databases","netcafe.db"),"original money");
    var journal=new UpdateJournal {Version="9.0.0",Kind="server",Token=token,Files=new[]{"app.js","new.js"},
        Originals=new(){{"app.js",UpdateJournal.Hash(Path.Combine(transaction,"backup","app.js"))}},
        Databases=new(){{"netcafe.db",UpdateJournal.Hash(Path.Combine(transaction,"databases","netcafe.db"))}}};
    System.Net.Sockets.TcpListener? listener=null;
    if(scenario=="corrupt-backup")File.WriteAllText(Path.Combine(transaction,"backup","app.js"),"damaged");
    if(scenario=="port-busy") {listener=new(System.Net.IPAddress.Loopback,0);listener.Start();journal.Port=((System.Net.IPEndPoint)listener.LocalEndpoint).Port;}
    if(scenario=="accepted")journal.Phase="ACCEPTED";
    journal.Save(transaction);
    try {
        if(scenario is "corrupt-backup" or "port-busy") {
            bool rejected=false;try{UpdateJournal.Recover(root);}catch(Exception error)when(error is IOException or InvalidDataException){rejected=true;}
            Check(rejected,"Unsafe recovery was accepted");
            Check(File.ReadAllText(Path.Combine(root,"app.js"))=="half-installed"&&File.ReadAllText(Path.Combine(root,"netcafe.db"))=="new schema","Unsafe recovery modified files");
        } else {
            Check(UpdateJournal.Recover(root),"Recovery failed");
            bool accepted=scenario=="accepted";
            Check(File.ReadAllText(Path.Combine(root,"netcafe.db"))==(accepted?"new schema":"original money"),"Wrong database generation restored");
            Check(File.Exists(Path.Combine(root,"new.js"))==accepted,"Rollback did not remove new-only application file");
            if(accepted)Check(File.Exists(Path.Combine(transaction,"approved.json")),"Accepted update lost activation after interruption");
            else Check(!UpdateJournal.HasPending(root)&&UpdateJournal.Recover(root),"Recovery is not idempotent");
        }
        Check(File.ReadAllText(Path.Combine(root,"config.json"))=="local configuration","Recovery changed local settings");
    } finally { listener?.Stop(); }
}
Console.WriteLine("PASS: interrupted transaction recovery, corrupt backup rejection, busy port, accepted commit and idempotency");

string handoverRoot=Path.GetFullPath(Path.Combine(".test-output","recovery-prepare-"+Guid.NewGuid().ToString("N")));
string handoverToken=Guid.NewGuid().ToString("N"),pendingDir=Path.Combine(handoverRoot,".ota",handoverToken);
Directory.CreateDirectory(pendingDir);
new UpdateJournal{Kind="server",Token=handoverToken,Version="9.0.0"}.Save(pendingDir);
using(var updaterGuard=new FileStream(Path.Combine(handoverRoot,".ota","update.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None))
    Check(!await RecoveryHandover.PrepareAsync(handoverRoot,Path.Combine(handoverRoot,"SoftechCockpit.exe")),"Recovery competed with active updater");
bool missingHelper=false;
try{await RecoveryHandover.PrepareAsync(handoverRoot,Path.Combine(handoverRoot,"SoftechCockpit.exe"));}catch(IOException){missingHelper=true;}
Check(missingHelper&&UpdateJournal.HasPending(handoverRoot),"Missing helper must leave UI and recovery evidence intact");
Console.WriteLine("PASS: recovery handover waits for existing updater and fails safely when helper is missing");
