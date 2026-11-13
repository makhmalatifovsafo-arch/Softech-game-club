using System.Runtime.InteropServices;
using Softech.Updates;

namespace SoftechService;

public static class Program
{
    public static int Main(string[] args)
    {
        try{return Execute(args);}catch(Exception error){Console.Error.WriteLine("Softech service: "+error.Message);return 1;}
    }
    private static int Execute(string[] args)
    {
        if(args.Length!=2||args[0] is not ("--service" or "--console"))return 2;
        string root=Path.GetFullPath(args[1]);
        if(args[0]=="--console") {
            using var stop=new CancellationTokenSource();Console.CancelKeyPress+=(_,e)=>{e.Cancel=true;stop.Cancel();};
            new BackendHost(root).Run(stop.Token).GetAwaiter().GetResult();return 0;
        }
        return ServiceDispatcher.Run(()=>new BackendHost(root));
    }
}

internal static class ServiceDispatcher
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void MainCallback(int count,IntPtr args);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void ControlCallback(uint code);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct Entry { public string? Name;public MainCallback? Main; }
    [StructLayout(LayoutKind.Sequential)] private struct Status { public uint Type,State,Accepted,ExitCode,Specific,Checkpoint,WaitHint; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool StartServiceCtrlDispatcher(Entry[] table);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr RegisterServiceCtrlHandler(string name,ControlCallback callback);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool SetServiceStatus(IntPtr handle,ref Status status);
    private static IntPtr handle;private static MainCallback? main;private static ControlCallback? control;
    private static void Report(uint state,uint accepted=0,uint error=0) {var status=new Status{Type=16,State=state,Accepted=accepted,ExitCode=error,WaitHint=180000};SetServiceStatus(handle,ref status);}
    public static int Run(Func<BackendHost> create)
    {
        main=(_,_)=>{
            using var stop=new CancellationTokenSource();
            control=code=>{if(code is 1 or 5){Report(3);stop.Cancel();}};
            handle=RegisterServiceCtrlHandler(ServerService.Name,control);if(handle==IntPtr.Zero)return;
            Report(2);uint error=0;
            try{Report(4,5);create().Run(stop.Token).GetAwaiter().GetResult();}catch{error=1;}
            Report(1,0,error);
        };
        return StartServiceCtrlDispatcher(new[]{new Entry{Name=ServerService.Name,Main=main},new Entry()})?0:Marshal.GetLastWin32Error();
    }
}
