using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Softech.Updates;

public static class RecoveryHandover
{
    // Launcher cannot replace its own executable. Prepare an independent helper
    // first, then ask the caller to exit; failure leaves the diagnostic UI open.
    public static async Task<bool> PrepareAsync(string target,string restartExecutable,CancellationToken cancellation=default)
    {
        if(!UpdateJournal.HasPending(target))return false;
        try { using var guard=new FileStream(PackageManifest.ChildPath(target,".ota/update.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None); }
        catch(IOException) { return false; } // Current updater still owns verification.
        PackageManifest.ChildPath(target,Path.GetRelativePath(target,restartExecutable));
        string source=UpdateJournal.RecoveryHelper(target);
        if(!File.Exists(source))throw new IOException("UPDATE_RECOVERY_REQUIRED: Tiklash vositasi topilmadi. Server setupi kerak.");
        string folder=PackageManifest.ChildPath(target,"updates/staging/handover-"+Guid.NewGuid());
        Directory.CreateDirectory(folder);
        string helper=Path.Combine(folder,"SoftechUpdater.exe");
        await Task.Run(()=>{File.Copy(source,helper);UpdateJournal.Flush(helper);},cancellation);
        var plan=new UpdatePlan {Target=target,Kind="server",RecoveryOnly=true,ParentPids=new[]{Environment.ProcessId},
            RestartExecutable=restartExecutable,ReadyFile=Path.Combine(folder,"ready"),CommitFile=Path.Combine(folder,"commit"),
            CancelFile=Path.Combine(folder,"cancel"),HealthFile=Path.Combine(folder,"healthy"),
            HealthUrl="http://127.0.0.1:5000/api/health",TimeoutSeconds=30};
        string file=Path.Combine(folder,"plan.json");UpdateJournal.Write(file,plan);
        var info=new ProcessStartInfo(helper){WorkingDirectory=folder,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
        info.ArgumentList.Add("--plan");info.ArgumentList.Add(file);
        using var process=Process.Start(info)??throw new IOException("UPDATE_RECOVERY_REQUIRED: Tiklash jarayoni ochilmadi.");
        try {
            var deadline=DateTime.UtcNow.AddSeconds(20);
            while(!File.Exists(plan.ReadyFile)) {
                if(process.HasExited||DateTime.UtcNow>=deadline)throw new IOException("UPDATE_RECOVERY_REQUIRED: Tiklash vositasi tayyor bo'lmadi. Oyna ochiq qoldirildi.");
                await Task.Delay(100,cancellation);
            }
            UpdateJournal.Write(plan.CommitFile,new{recover=true});
            return true;
        } catch { try{File.WriteAllText(plan.CancelFile,"cancel");}catch{}throw; }
    }
}
