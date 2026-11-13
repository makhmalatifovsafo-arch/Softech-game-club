using System.Diagnostics;
using Softech.Updates;

internal static class UpdateFileLocks
{
    private static void Check(bool value,string message){if(!value)throw new Exception(message);}
    private static int RejectedMove(string source,string destination)
    {
        try{File.Move(source,destination,true);}
        catch(Exception error)when(error is IOException or UnauthorizedAccessException){return error.HResult&0xffff;}
        throw new Exception("Fixture did not reproduce a locked replacement");
    }
    internal static async Task Run()
    {
        if(!OperatingSystem.IsWindows())return;
        string root=Path.GetFullPath(Path.Combine(".test-output","file-locks-"+Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(root);
        string source=Path.Combine(root,"staged"),destination=Path.Combine(root,"application");
        File.WriteAllText(source,"new");File.WriteAllText(destination,"old");
        using(var held=new FileStream(destination,FileMode.Open,FileAccess.Read,FileShare.Read)){
            Check(RejectedMove(source,destination) is 5 or 32 or 33,"Expected a real Windows access/sharing violation");
            var release=Task.Run(async()=>{await Task.Delay(350);held.Dispose();});
            await Task.Run(()=>UpdateJournal.ReplaceFile(source,destination,TimeSpan.FromSeconds(5)));
            await release;
        }
        Check(File.ReadAllText(destination)=="new"&&!File.Exists(source),"Released sharing lock did not recover");

        File.WriteAllText(source,"after transient access denial");File.SetAttributes(destination,FileAttributes.ReadOnly);
        try{
            Check(RejectedMove(source,destination)==5,"Expected actual ERROR_ACCESS_DENIED");
            var release=Task.Run(async()=>{await Task.Delay(350);File.SetAttributes(destination,FileAttributes.Normal);});
            await Task.Run(()=>UpdateJournal.ReplaceFile(source,destination,TimeSpan.FromSeconds(5)));
            await release;
        }finally{File.SetAttributes(destination,FileAttributes.Normal);}

        // Reproduce the CI failure on a real mapped executable, not only a mocked IOException.
        string executable=Path.Combine(root,"held.exe"),replacement=Path.Combine(root,"replacement.exe");
        File.Copy(Path.Combine(Environment.SystemDirectory,"cmd.exe"),executable);
        File.Copy(executable,replacement);
        var start=new ProcessStartInfo(executable){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,
            RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
        start.ArgumentList.Add("/d");start.ArgumentList.Add("/q");
        using(var process=Process.Start(start)??throw new Exception("Executable fixture failed")){
            try{
                Check(!process.HasExited&&RejectedMove(replacement,executable)==5,"Mapped EXE did not reproduce access denial");
                var release=Task.Run(async()=>{await Task.Delay(350);await process.StandardInput.WriteLineAsync("exit");await process.WaitForExitAsync();});
                await Task.Run(()=>UpdateJournal.ReplaceFile(replacement,executable,TimeSpan.FromSeconds(5)));
                await release;
            }finally{if(!process.HasExited){process.Kill();await process.WaitForExitAsync();}}
        }
        Check(UpdateJournal.Hash(executable)==UpdateJournal.Hash(Path.Combine(Environment.SystemDirectory,"cmd.exe")),"Executable changed during retry");

        string transaction=Path.Combine(root,".ota",Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(transaction,"backup"));Directory.CreateDirectory(Path.Combine(transaction,"databases"));
        string app=Path.Combine(root,"app.js"),database=Path.Combine(root,"money.db");
        File.WriteAllText(app,"new code");File.WriteAllText(database,"new schema");
        File.WriteAllText(Path.Combine(transaction,"backup","app.js"),"old code");
        File.WriteAllText(Path.Combine(transaction,"databases","money.db"),"original money");
        var journal=new UpdateJournal{Kind="server",Version="9.0.0",Token=Path.GetFileName(transaction),Files=["app.js"],
            Originals=new(){{"app.js",UpdateJournal.Hash(Path.Combine(transaction,"backup","app.js"))}},
            Databases=new(){{"money.db",UpdateJournal.Hash(Path.Combine(transaction,"databases","money.db"))}}};
        journal.Save(transaction);
        using(var held=new FileStream(app,FileMode.Open,FileAccess.Read,FileShare.Read)){
            bool rejected=false;
            try{journal.Restore(root,transaction,TimeSpan.FromMilliseconds(150));}
            catch(IOException error){rejected=error.Message.Contains("app.js")&&error.InnerException is not null&&(error.InnerException.HResult&0xffff) is 5 or 32 or 33;}
            Check(rejected&&UpdateJournal.HasPending(root),"Persistent lock was silently accepted");
            Check(File.ReadAllText(app)=="new code"&&File.ReadAllText(database)=="new schema","Failed application recovery touched database");
            Check(!Directory.GetFiles(root,"*.restore.tmp").Any(),"Failed restore leaked temporary files");
        }
        Check(UpdateJournal.Recover(root)&&!UpdateJournal.HasPending(root),"Recovery could not resume after lock release");
        Check(File.ReadAllText(app)=="old code"&&File.ReadAllText(database)=="original money","Retry lost recovery data");
        Check(File.Exists(Path.Combine(transaction,"databases","money.db")),"Recovery evidence deleted");
        int attempts=0;
        try{UpdateJournal.RetryFileOperation(()=>{attempts++;throw new IOException("disk full",unchecked((int)0x80070070));},destination);}
        catch(IOException){Check(attempts==1,"Non-lock error was retried");}
        Console.WriteLine("PASS real mapped EXE/access/sharing locks recover after release; persistent locks retain journal/database/backups and resume safely");
    }
}
