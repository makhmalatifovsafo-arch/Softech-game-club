using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;

namespace Softech.Updates;

public static class ServerService
{
    public const string Name="SoftechServer";
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder name,ref int length);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    public static string ProcessPath(int pid) {
        IntPtr handle=OpenProcess(0x1000,false,pid);if(handle==IntPtr.Zero)return "";
        try{var name=new StringBuilder(32768);int size=name.Capacity;return QueryFullProcessImageName(handle,0,name,ref size)?name.ToString():"";}finally{CloseHandle(handle);}
    }
    public static bool Installed(string root)
    {
        if(!OperatingSystem.IsWindows())return false;
        using var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\"+Name);
        if(key==null)return false;
        string expected=Path.Combine(Path.GetFullPath(root),".service","SoftechService.exe");
        string command=key.GetValue("ImagePath") as string??"";
        return command.StartsWith("\""+expected+"\"",StringComparison.OrdinalIgnoreCase);
    }
    public static void Command(params string[] arguments)
    {
        var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"sc.exe")){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(string argument in arguments)info.ArgumentList.Add(argument);
        using var process=Process.Start(info)??throw new IOException("Windows xizmat boshqaruvini ochib bo'lmadi.");
        var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();
        if(!process.WaitForExit(30000))throw new IOException("Windows xizmat buyrug'i vaqtida tugamadi.");
        if(process.ExitCode!=0)throw new IOException("Windows xizmat buyrug'i bajarilmadi: "+output.GetAwaiter().GetResult()+error.GetAwaiter().GetResult());
    }
    [StructLayout(LayoutKind.Sequential)] private struct Status { public uint Type,State,Accepted,ExitCode,Specific,Checkpoint,WaitHint; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr OpenSCManager(string? machine,string? database,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr OpenService(IntPtr manager,string name,uint access);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool QueryServiceStatus(IntPtr service,out Status status);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool ControlService(IntPtr service,uint control,out Status status);
    [DllImport("advapi32.dll")] private static extern bool CloseServiceHandle(IntPtr handle);
    public static bool Exists {
        get {if(!OperatingSystem.IsWindows())return false;using var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\"+Name);return key!=null;}
    }
    public static void StopAndWait(string root) {
        if(!Exists)return;
        if(!Installed(root))throw new IOException("Softech xizmati boshqa papkaga tegishli. Mavjud o'rnatma manzilini tanlang.");
        IntPtr manager=OpenSCManager(null,null,1),service=IntPtr.Zero;
        try {
            if(manager==IntPtr.Zero)throw new IOException("Xizmatni boshqarish uchun administrator huquqi kerak.");
            service=OpenService(manager,Name,0x24);
            if(service==IntPtr.Zero||!QueryServiceStatus(service,out var status))throw new IOException("Xizmat holatini aniqlab bo'lmadi.");
            if(status.State==1)return;
            if(status.State!=3&&!ControlService(service,1,out status))throw new IOException("Xizmatni to'xtatib bo'lmadi.");
            var until=DateTime.UtcNow.AddMinutes(4);
            do {if(!QueryServiceStatus(service,out status))throw new IOException("Xizmat holati yo'qoldi.");if(status.State==1)return;Thread.Sleep(250);}while(DateTime.UtcNow<until);
            throw new IOException("Xizmat hali to'xtamadi. Fayllar almashtirilmadi.");
        }finally{if(service!=IntPtr.Zero)CloseServiceHandle(service);if(manager!=IntPtr.Zero)CloseServiceHandle(manager);}
    }
}
