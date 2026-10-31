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
