using System.ServiceProcess;
using Softech.Updates;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("ServiceCancellation")]

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
        using var service=new WindowsBackendService(root);
        ServiceBase.Run(service);
        return service.ExitCode;
    }
}

internal sealed class WindowsBackendService : ServiceBase
{
    private readonly string root;
    private readonly Action<int> requestAdditionalTime;
    private readonly CancellationTokenSource cancellation=new();
    private Task? worker;
    private int stopping;
    public WindowsBackendService(string root,Action<int>? requestAdditionalTime=null)
    {
        this.root=root;ServiceName=ServerService.Name;CanStop=true;CanShutdown=true;
        this.requestAdditionalTime=requestAdditionalTime??RequestAdditionalTime;
        AutoLog=false; // LocalService does not need permission to create an EventLog source.
    }
    private void Log(string message)=>BoundedLog.Append(Path.Combine(root,"logs","service.log"),message);
    protected override void OnStart(string[] args)=>StartWorker();
    internal void StartWorker()
    {
        worker=Task.Run(()=>new BackendHost(root).Run(cancellation.Token));
        _=worker.ContinueWith(task=>{
            if(Volatile.Read(ref stopping)!=0)return;
            Log("Service worker ended unexpectedly: "+(task.Exception?.ToString()??"no stop requested"));
            // A failed host must trigger SCM recovery; it can then adopt any
            // surviving owned backend. Never report a successful normal stop.
            Environment.Exit(1);
        },CancellationToken.None,TaskContinuationOptions.None,TaskScheduler.Default);
    }
    protected override void OnStop()=>StopWorker();
    internal void StopWorker(bool extendDeadline=true)
    {
        Interlocked.Exchange(ref stopping,1);
        if(extendDeadline)requestAdditionalTime(240000);
        Log("SCM stop requested; waiting for backend shutdown.");
        try{
            // ServiceBase reports STOPPED only after this method returns.
            // CancelAsync keeps worker continuations off the SCM control callback.
            Task.WhenAll(cancellation.CancelAsync(),worker??Task.CompletedTask).GetAwaiter().GetResult();
            Log("SCM shutdown completed.");
        }catch(Exception error){
            ExitCode=1;Log("SCM shutdown failed: "+error);
            throw; // No successful STOPPED acknowledgement while shutdown failed.
        }
    }
    // RequestAdditionalTime is supported during OnStop's STOP_PENDING state,
    // not during the separate Windows shutdown notification.
    protected override void OnShutdown()=>StopWorker(false);
    protected override void Dispose(bool disposing)
    {
        if(disposing&&(worker==null||worker.IsCompleted))cancellation.Dispose();
        base.Dispose(disposing);
    }
}
