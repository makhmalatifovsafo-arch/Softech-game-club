using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using Softech.Updates;
using System.Text.Json;
using System.Net.Http;

namespace ServerSetup;

internal static class ServiceInstallation
{
    public static void EnsureEmergencySessionsClosed()
    {
        bool emergency=false;
        try {
            using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(2)};
            using var health=client.GetAsync("http://127.0.0.1:5000/api/health").GetAwaiter().GetResult();
            if(!health.IsSuccessStatusCode)return;
            using var status=JsonDocument.Parse(health.Content.ReadAsStringAsync().GetAwaiter().GetResult());
            emergency=status.RootElement.TryGetProperty("app",out var app)&&app.GetString()=="NetCafeEmergency";
            if(!emergency)return;
        }catch(Exception error)when(error is HttpRequestException or TaskCanceledException or JsonException){return;}
        try {
            using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(2)};
            using var state=JsonDocument.Parse(client.GetStringAsync("http://127.0.0.1:5000/api/emergency/state").GetAwaiter().GetResult());
            foreach(var computer in state.RootElement.GetProperty("clients").EnumerateArray())
                if(computer.TryGetProperty("activeSession",out var active)&&active.ValueKind==JsonValueKind.Object)
                    throw new IOException("Favqulodda seanslar ochiq. Avval ularni favqulodda oynadan yoping; setup ma'lumotni aralashtirmaydi.");
        }catch(IOException){throw;}
        catch(Exception error){throw new IOException("Favqulodda seans holatini tekshirib bo'lmadi. Setup xavfsizlik uchun to'xtatildi.",error);}
    }
    public static void Install(string root)
    {
        root=Path.GetFullPath(root);
        if(ServerService.Exists&&!ServerService.Installed(root))throw new IOException("Mavjud Windows xizmati boshqa papkaga tegishli.");
        string source=PackageManifest.ChildPath(root,"SoftechService.exe"),host=PackageManifest.ChildPath(root,".service/SoftechService.exe");
        if(!File.Exists(source))throw new IOException("Paketda SoftechService.exe yo'q. To'liq yangi Server setup kerak.");
        Directory.CreateDirectory(Path.GetDirectoryName(host)!);
        File.Copy(source,host,true);
        // The worker has no administrator privileges. Only its own installation is writable.
        var directory=new DirectoryInfo(root);var acl=directory.GetAccessControl();
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalServiceSid,null),FileSystemRights.Modify,
            InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        directory.SetAccessControl(acl);
        var privateDirectory=Directory.CreateDirectory(PackageManifest.ChildPath(root,".service/private"));
        var restricted=new DirectorySecurity();restricted.SetAccessRuleProtection(true,false);
        foreach(var sid in new[]{WellKnownSidType.LocalServiceSid,WellKnownSidType.LocalSystemSid,WellKnownSidType.BuiltinAdministratorsSid})
            restricted.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        privateDirectory.SetAccessControl(restricted);
        ServerService.Command(ServerService.Exists?"config":"create",ServerService.Name,"binPath=",$"\"{host}\" --service \"{root}\"","start=","auto","obj=",@"NT AUTHORITY\LocalService");
        ServerService.Command("description",ServerService.Name,"Softech club server; cashier window is independent.");
        ServerService.Command("failure",ServerService.Name,"reset=","86400","actions=","restart/10000/restart/30000/restart/60000");
        ServerService.Command("failureflag",ServerService.Name,"1");
        // Services must accept LAN clients even before an interactive user signs in.
        var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"netsh.exe")){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
        foreach(var argument in new[]{"advfirewall","firewall","add","rule","name=Softech Server Service","dir=in","action=allow","protocol=TCP","localport=5000","program="+Path.Combine(root,"runtime","node.exe")})info.ArgumentList.Add(argument);
        using var firewall=Process.Start(info)??throw new IOException("Firewall sozlanmadi.");
        if(!firewall.WaitForExit(30000)||firewall.ExitCode!=0)throw new IOException("Firewall qoidasini qo'shib bo'lmadi.");
        ServerService.Command("start",ServerService.Name);
    }
}
