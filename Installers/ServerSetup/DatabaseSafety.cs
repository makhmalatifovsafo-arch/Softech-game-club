using System;
using System.Diagnostics;
using System.IO;

namespace ServerSetup;

internal static class DatabaseSafety
{
    public static void Backup(string directory)
    {
        string database = Path.Combine(directory, "netcafe.db");
        if (!File.Exists(database))
        {
            if (File.Exists(Path.Combine(directory, "data", "database-created.json")) || File.Exists(database + "-wal"))
                throw new IOException("Baza topilmadi. Avval zaxiradan tiklang; yangi bo‘sh baza yaratilmaydi.");
            return;
        }
        string runtime = Path.Combine(directory, "runtime", "node.exe");
        if (!File.Exists(runtime)) throw new IOException("Baza zaxirasi uchun mavjud runtime/node.exe kerak. O‘rnatish to‘xtatildi.");
        string backups = Path.Combine(directory, "data", "backups");
        Directory.CreateDirectory(backups);
        string destination = Path.Combine(backups, $"setup-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():D}.db");
        const string script = """
            const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');
            const [source,output]=process.argv.slice(1);const partial=output+'.partial';
            const db=new DatabaseSync(source,{readOnly:true});
            try {
              if(db.prepare('PRAGMA quick_check').all().some(r=>Object.values(r)[0]!=='ok'))throw Error('Database integrity check failed');
              db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL');
              db.prepare('VACUUM INTO ?').run(partial);
              const check=new DatabaseSync(partial,{readOnly:true});
              try{if(check.prepare('PRAGMA quick_check').all().some(r=>Object.values(r)[0]!=='ok'))throw Error('Backup integrity check failed');}finally{check.close();}
              const fd=fs.openSync(partial,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
              fs.renameSync(partial,output);
            }finally{db.close();}
            """;
        var info = new ProcessStartInfo(runtime) { UseShellExecute = false, CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardError = true };
        info.ArgumentList.Add("-e"); info.ArgumentList.Add(script);
        info.ArgumentList.Add(database); info.ArgumentList.Add(destination);
        using var process = Process.Start(info) ?? throw new IOException("Zaxiralash ishga tushmadi.");
        string error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0 || !File.Exists(destination)) throw new IOException("Baza zaxiralanmadi. O‘rnatish to‘xtatildi: " + error);
    }
}
