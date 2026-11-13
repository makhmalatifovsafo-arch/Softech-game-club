using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text.Json;

namespace Softech.Updates;

public sealed class UpdateJournal
{
    public string Phase { get; set; } = "APPLYING";
    public string Version { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Token { get; set; } = "";
    public string[] Files { get; set; } = Array.Empty<string>();
    public Dictionary<string,string> Originals { get; set; } = new();
    public Dictionary<string,string> Databases { get; set; } = new();
    public int Port { get; set; }
    public int RestartedPid { get; set; }
    public long RestartedStartTicks { get; set; }
    public string RestartedExecutable { get; set; } = "";
    public string HelperRelativePath { get; set; } = "";

    public static string Hash(string file) { using var input=File.OpenRead(file); return Convert.ToHexString(SHA256.HashData(input)); }
    public static void Flush(string file) { using var stream=new FileStream(file,FileMode.Open,FileAccess.ReadWrite,FileShare.Read);stream.Flush(true); }
    public static void Write(string file,object value)
    {
        string temporary=file+"."+Guid.NewGuid().ToString("N")+".tmp";
        try {
            using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write)) {
                JsonSerializer.Serialize(stream,value,PackageManifest.JsonOptions);stream.Flush(true);
            }
            File.Move(temporary,file,true);
        } finally { if(File.Exists(temporary))File.Delete(temporary); }
    }
    public void Save(string transaction) => Write(Path.Combine(transaction,"journal.json"),this);
    private static void RestoreFile(string backup,string destination)
    {
        string temporary=destination+"."+Guid.NewGuid().ToString("N")+".restore.tmp";
        try{File.Copy(backup,temporary,false);Flush(temporary);File.Move(temporary,destination,true);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }

    private static IEnumerable<string> Transactions(string target)
    {
        string ota=PackageManifest.ChildPath(target,".ota");
        if(!Directory.Exists(ota))return Array.Empty<string>();
        return Directory.GetDirectories(ota).Where(dir=>Guid.TryParseExact(Path.GetFileName(dir),"N",out _)).ToArray();
    }
    private static UpdateJournal? Read(string target,string transaction)
    {
        string file=PackageManifest.ChildPath(target,".ota/"+Path.GetFileName(transaction)+"/journal.json");
        if(!File.Exists(file))return null; // Legacy completed backup, never guess a rollback.
        return JsonSerializer.Deserialize<UpdateJournal>(File.ReadAllText(file),PackageManifest.JsonOptions)
            ?? throw new InvalidDataException("Update journal is unreadable; recovery evidence retained.");
    }
    public static bool HasPending(string target) => Transactions(target).Any(dir=>Read(target,dir)?.Phase=="APPLYING");
    public static string RecoveryHelper(string target)
    {
        foreach(string transaction in Transactions(target)) {
            var journal=Read(target,transaction);
            if(journal?.Phase!="APPLYING"||!journal.HelperRelativePath.Replace('\\','/').StartsWith("updates/staging/handover-",StringComparison.OrdinalIgnoreCase))continue;
            string file=PackageManifest.ChildPath(target,journal.HelperRelativePath);
            if(File.Exists(file))return file;
        }
        return PackageManifest.ChildPath(target,"SoftechUpdater.exe");
    }
    public static bool PortBusy(int port) => port>0&&IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint=>endpoint.Port==port);
    public static FileStream AcquireServerLock(string target)
    {
        string file=PackageManifest.ChildPath(target,"data/server-instance.db");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        // Windows sharing locks also conflict with SQLite's open connection.
        // Protects migrations before listen() and manual starts during recovery.
        return new FileStream(file,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    }

    // Called before launching Node. An active updater keeps exclusive ownership.
    public static bool Recover(string target,Action<string>? log=null)
    {
        string lockPath=PackageManifest.ChildPath(target,".ota/update.lock");
        if(!Directory.Exists(Path.GetDirectoryName(lockPath)))return true;
        FileStream guard;
        try { guard=new FileStream(lockPath,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None); }
        catch(IOException) { return false; }
        using(guard)foreach(string transaction in Transactions(target)) {
            var journal=Read(target,transaction);
            if(journal?.Phase=="ACCEPTED"&&journal.Kind=="server") {
                if(journal.Token!=Path.GetFileName(transaction))throw new InvalidDataException("Update activation identity mismatch.");
                string approved=PackageManifest.ChildPath(transaction,"approved.json");
                if(!File.Exists(approved))Write(approved,new{token=journal.Token});
            }
            if(journal?.Phase!="APPLYING")continue;
            // PID reuse must never kill an unrelated process. The executable and
            // exact OS start time must match the process created by this update.
            if(journal.RestartedPid>0)try {
                using var process=Process.GetProcessById(journal.RestartedPid);
                string executable=PackageManifest.ChildPath(target,Path.GetRelativePath(target,journal.RestartedExecutable));
                if(process.StartTime.ToUniversalTime().Ticks==journal.RestartedStartTicks&&
                   string.Equals(process.MainModule?.FileName,executable,StringComparison.OrdinalIgnoreCase)) {
                    process.Kill(entireProcessTree:true);
                    if(!process.WaitForExit(10000))throw new IOException("Updated process has not stopped.");
                }
            } catch(ArgumentException) { }
            var stopDeadline=DateTime.UtcNow.AddSeconds(10);
            while(PortBusy(journal.Port)&&DateTime.UtcNow<stopDeadline)System.Threading.Thread.Sleep(100);
            if(PortBusy(journal.Port))throw new IOException("Recovery postponed: server port is busy. No files were restored.");
            using(var serverGuard=journal.Kind=="server"?AcquireServerLock(target):null)
                journal.Restore(target,transaction);
            log?.Invoke("Interrupted update restored to previous application; original evidence retained.");
        }
        return true;
    }

    public void Restore(string target,string transaction)
    {
        // Check all backup bytes before changing a single application/database file.
        foreach(var entry in Originals.Concat(Databases)) {
            bool database=Databases.ContainsKey(entry.Key);
            string file=PackageManifest.ChildPath(transaction,(database?"databases/":"backup/")+entry.Key);
            if(!string.Equals(Hash(file),entry.Value,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Rollback backup integrity failure; files retained.");
        }
        foreach(string relative in Files) {
            if(PackageManifest.Preserved(relative))throw new InvalidDataException("Journal contains protected application path.");
            PackageManifest.ChildPath(target,relative);
        }
        foreach(string relative in Databases.Keys) {
            string normalized=relative.Replace('\\','/');
            if(normalized.StartsWith("data/backups/",StringComparison.OrdinalIgnoreCase)||
               normalized.StartsWith("data/server-instance.db",StringComparison.OrdinalIgnoreCase)||
               !(normalized.EndsWith(".db",StringComparison.OrdinalIgnoreCase)||normalized.EndsWith(".db-wal",StringComparison.OrdinalIgnoreCase)||normalized.EndsWith(".db-shm",StringComparison.OrdinalIgnoreCase)||normalized.EndsWith(".db-journal",StringComparison.OrdinalIgnoreCase)))throw new InvalidDataException("Invalid database recovery path.");
            PackageManifest.ChildPath(target,relative);
        }
        foreach(string relative in Files) {
            string destination=PackageManifest.ChildPath(target,relative);
            if(Originals.ContainsKey(relative)) {
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                RestoreFile(PackageManifest.ChildPath(transaction,"backup/"+relative),destination);
            } else if(File.Exists(destination))File.Delete(destination);
        }
        foreach(string relative in Databases.Keys.Where(name=>name.EndsWith(".db",StringComparison.OrdinalIgnoreCase)))
            foreach(string suffix in new[]{"-wal","-shm","-journal"}) {
                string sidecar=PackageManifest.ChildPath(target,relative+suffix);
                if(File.Exists(sidecar))File.Delete(sidecar);
            }
        foreach(string relative in Databases.Keys) {
            string destination=PackageManifest.ChildPath(target,relative);
            RestoreFile(PackageManifest.ChildPath(transaction,"databases/"+relative),destination);
        }
        Write(PackageManifest.ChildPath(target,"updates-failed-version.json"),new{version=Version,error="Interrupted or unhealthy update",at=DateTimeOffset.UtcNow});
        Phase="ROLLED_BACK";Save(transaction);
    }
}
