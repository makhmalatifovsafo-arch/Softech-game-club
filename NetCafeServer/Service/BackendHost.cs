using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text.Json;
using Softech.Updates;
using SoftechCockpit;

namespace SoftechService;

public sealed class BackendHost(string root)
{
    private Process? child;
    private bool emergencyChild;
    private bool forceEmergency;
    private readonly HttpClient http=new(){Timeout=TimeSpan.FromSeconds(2)};
    private readonly ServerDiagnostics diagnostics=new();
    private readonly Queue<DateTimeOffset> attempts=new();
    private string errorCode="NONE",secret="";
    private DateTimeOffset nextStart=DateTimeOffset.MinValue,nextDiagnostic=DateTimeOffset.MinValue,nextStatus=DateTimeOffset.MinValue;
    private readonly int port=int.TryParse(Environment.GetEnvironmentVariable("PORT"),out var p)&&p>0&&p<65536?p:5000;
    private readonly int retrySeconds=Environment.GetEnvironmentVariable("NODE_ENV")=="test"&&int.TryParse(Environment.GetEnvironmentVariable("SOFTECH_SERVICE_TEST_RETRY_SECONDS"),out var retry)&&retry>=0&&retry<=10?retry:10;
    private string StatusFile=>Path.Combine(root,"data","service-status.json");
    private void Log(string message) => BoundedLog.Append(Path.Combine(root,"logs","service.log"),message);
    private bool Updating()
    {
        string file=PackageManifest.ChildPath(root,".ota/update.lock");Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        try{using var guard=new FileStream(file,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);return false;}catch(IOException){return true;}
    }
    private bool TakeEmergencyRequest()
    {
        string file=PackageManifest.ChildPath(root,".service/emergency.request");
        if(!File.Exists(file))return false;
        try{
            using var json=JsonDocument.Parse(File.ReadAllText(file));
            var requested=json.RootElement.GetProperty("requestedAt").GetDateTimeOffset();
            return DateTimeOffset.UtcNow-requested>=TimeSpan.Zero&&DateTimeOffset.UtcNow-requested<TimeSpan.FromMinutes(2);
        }catch{return false;}finally{try{File.Delete(file);}catch{}}
    }
    private async Task<bool> Adopt()
    {
        try{
            using var response=await http.GetAsync($"http://127.0.0.1:{port}/api/health");
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync());var h=json.RootElement;
            string? app=h.GetProperty("app").GetString();
            if(!response.IsSuccessStatusCode||app is not ("NetCafeServer" or "NetCafeEmergency")||h.GetProperty("status").GetString()!="ok")return false;
            int pid=h.GetProperty("processId").GetInt32();using var found=Process.GetProcessById(pid);
            if(!string.Equals(ServerService.ProcessPath(pid),Path.Combine(root,"runtime","node.exe"),StringComparison.OrdinalIgnoreCase))return false;
            if(child==null||child.HasExited||child.Id!=pid){child?.Dispose();child=Process.GetProcessById(pid);Log("Backend adopted: "+pid);}
            emergencyChild=app=="NetCafeEmergency";
            if(h.TryGetProperty("updatePending",out var pending)&&pending.ValueKind==JsonValueKind.True)return false;
            if(!emergencyChild)errorCode="NONE";return true;
        }catch{return false;}
    }
    private void Start()
    {
        if(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(e=>e.Port==port)){errorCode="PORT_BUSY";return;}
        var now=DateTimeOffset.UtcNow;
        while(attempts.TryPeek(out var prior)&&now-prior>TimeSpan.FromMinutes(5))attempts.Dequeue();
        if(now<nextStart){if(errorCode=="NONE")errorCode="PROCESS_EXIT";return;}
        if(forceEmergency||attempts.Count>=3){forceEmergency=false;StartProcess("src/emergency-server.js",true);return;}
        attempts.Enqueue(now);nextStart=now.AddSeconds(retrySeconds);
        StartProcess("src/server.js",false);
    }
    private void StartProcess(string script,bool emergency)
    {
        if(!File.Exists(PackageManifest.ChildPath(root,script))){errorCode="SCRIPT_MISSING";return;}
        var info=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe")){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardError=true,RedirectStandardOutput=true};
        info.ArgumentList.Add(script);
        foreach(string key in new[]{"SOFTECH_COCKPIT_PID","SOFTECH_COCKPIT_EXE","SOFTECH_UPDATE_TOKEN","SOFTECH_UPDATER_RESTART","SOFTECH_RECOVERY_FAILED"})info.Environment.Remove(key);
        info.Environment["SOFTECH_SERVICE_ROOT"]=root;info.Environment["SOFTECH_SERVICE_CONTROL_SECRET"]=secret;
        child?.Dispose();child=new Process{StartInfo=info};emergencyChild=emergency;
        child.ErrorDataReceived+=(_,e)=>{if(e.Data!=null){var code=ServerDiagnostics.Classify(e.Data);if(code!="UNKNOWN")errorCode=code;Log(e.Data);}};
        child.OutputDataReceived+=(_,e)=>{if(e.Data!=null)Log(e.Data);};
        child.Start();child.BeginErrorReadLine();child.BeginOutputReadLine();Log((emergency?"Emergency backend":"Backend")+" started: "+child.Id);
    }
    public async Task Run(CancellationToken stop)
    {
        Directory.CreateDirectory(Path.Combine(root,"data"));Directory.CreateDirectory(Path.Combine(root,".service","private"));
        using var owner=new FileStream(PackageManifest.ChildPath(root,".service/host.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
        string key=Path.Combine(root,".service","private","control.key");
        if(File.Exists(key))try {
            if(new FileInfo(key).Length>1024)throw new JsonException("Invalid control key size");
            using var json=JsonDocument.Parse(File.ReadAllText(key));
            secret=json.RootElement.GetProperty("secret").GetString()??"";
            if(secret.Length!=64||secret.Any(c=>!Uri.IsHexDigit(c)))secret="";
        }catch(Exception error)when(error is JsonException or KeyNotFoundException or InvalidOperationException){secret="";}
        if(secret.Length==0){
            if(File.Exists(key))File.Copy(key,key+".corrupt-"+Guid.NewGuid().ToString("N")+".bak");
            secret=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));UpdateJournal.Write(key,new{secret});
            Log("Local service control key initialized; club identity and database unchanged.");
        }
        try{
            while(!stop.IsCancellationRequested){
                try{
                    bool updating=Updating(),healthy=false;
                    if(!updating){
                        bool recovered=!UpdateJournal.HasPending(root)||UpdateJournal.Recover(root,Log);
                        if(recovered){
                            if(TakeEmergencyRequest()){
                                bool mainHealthy=await Adopt();
                                if(!mainHealthy&&!emergencyChild){
                                    if(child is {HasExited:false}){child.Kill();await child.WaitForExitAsync();}
                                    child?.Dispose();child=null;forceEmergency=true;nextStart=DateTimeOffset.MinValue;
                                    Log("Emergency mode requested from the local cashier.");
                                }
                            }
                            healthy=await Adopt();
                            if(!healthy&&child is {HasExited:true}&&emergencyChild){
                                int code=child.ExitCode;child.Dispose();child=null;emergencyChild=false;
                                if(code==75){attempts.Clear();nextStart=DateTimeOffset.MinValue;Log("Main backend retry requested.");}
                                else nextStart=DateTimeOffset.UtcNow.AddSeconds(code is 78 or 79?300:retrySeconds);
                            }
                            if(!healthy&&(child==null||child.HasExited))Start();
                        }
                    }
                    var state=healthy?(emergencyChild?"EMERGENCY":"RUNNING"):updating||child is {HasExited:false}?"STARTING":"FAILED";
                    if(DateTimeOffset.UtcNow>=nextStatus){
                        nextStatus=DateTimeOffset.UtcNow.AddSeconds(10);
                        try{UpdateJournal.Write(StatusFile,new{hostPid=Environment.ProcessId,backendPid=child is {HasExited:false}?child.Id:0,observedAt=DateTimeOffset.UtcNow,state,errorCode});}catch(Exception error){Log("Status write: "+error.Message);}
                    }
                    if(DateTimeOffset.UtcNow>=nextDiagnostic){
                        nextDiagnostic=DateTimeOffset.UtcNow.AddSeconds(60);
                        var report=ServerDiagnostics.Collect(root,state,errorCode);
                        await diagnostics.SendAsync(root,report,stop);
                    }
                }catch(OperationCanceledException)when(stop.IsCancellationRequested){break;}
                catch(Exception error){errorCode=ServerDiagnostics.Classify(error.Message);Log(error.Message);}
                // Console fixture exit is opt-in and never used by installed services.
                string? fixture=Environment.GetEnvironmentVariable("SOFTECH_SERVICE_TEST_STOP_FILE");
                if(Environment.GetEnvironmentVariable("NODE_ENV")=="test"&&fixture!=null&&File.Exists(PackageManifest.ChildPath(root,fixture)))break;
                try{await Task.Delay(1000,stop);}catch(OperationCanceledException){break;}
            }
        }finally{await Stop();http.Dispose();}
    }
    private async Task Stop()
    {
        // An updater owns the files/child while its transaction lock is held.
        var deadline=DateTimeOffset.UtcNow.AddSeconds(150);
        while(Updating()&&DateTimeOffset.UtcNow<deadline)await Task.Delay(250);
        if(Updating()){Log("Updater still owns the backend; service shutdown leaves its transaction intact.");child?.Dispose();return;}
        await Adopt();
        if(child is {HasExited:false}){
            try{
                using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(35)};
                using var request=new HttpRequestMessage(HttpMethod.Post,$"http://127.0.0.1:{port}/api/internal/service-stop");
                request.Headers.Add("X-Softech-Service-Key",secret);await client.SendAsync(request);
                await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            }catch(Exception error){Log("Service stop: "+error.Message);}
            if(!child.HasExited){Log("Backend did not drain within deadline; terminating owned process, SQLite WAL retained.");child.Kill();await child.WaitForExitAsync();}
        }
        child?.Dispose();Log("Service stopped.");
    }
}
