using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32;
using Softech.Updates;
using ServerSetup;

if(args.Length==1&&args[0]=="--probe-tests"){
    await StoppedBackendProbe.SelfTest();return;
}

// Intentionally restricted to a disposable hosted CI machine. Never install or
// replace a real club's service as part of a developer's ordinary npm test.
if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted")
    throw new InvalidOperationException("SCM test requires a disposable GitHub-hosted Windows runner.");
if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)||ServerService.Exists)
    throw new InvalidOperationException("SCM fixture requires administrator access and no existing Softech service.");
if(args.Length!=2)throw new ArgumentException("Published service executable and Node executable required.");
string root=Path.GetFullPath(Path.Combine(".test-output","scm-"+Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
void CopyTree(string from,string to){Directory.CreateDirectory(to);foreach(string file in Directory.GetFiles(from))File.Copy(file,Path.Combine(to,Path.GetFileName(file)));foreach(string dir in Directory.GetDirectories(from))CopyTree(dir,Path.Combine(to,Path.GetFileName(dir)));}
foreach(string name in new[]{"src","public"})CopyTree(Path.Combine("NetCafeServer",name),Path.Combine(root,name));
CopyTree("node_modules",Path.Combine(root,"node_modules"));
foreach(string name in new[]{"schema.sql","package.json"})File.Copy(Path.Combine("NetCafeServer",name),Path.Combine(root,name));
Directory.CreateDirectory(Path.Combine(root,"runtime"));File.Copy(args[1],Path.Combine(root,"runtime","node.exe"));
File.Copy(args[0],Path.Combine(root,"SoftechService.exe"));File.WriteAllText(Path.Combine(root,"config.json"),"{}");
var listener=new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback,0);listener.Start();int port=((System.Net.IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(2)};
async Task<int> Ready(int previous=0){var until=DateTime.UtcNow.AddSeconds(90);while(DateTime.UtcNow<until){try{
    using var doc=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/api/health"));
    int pid=doc.RootElement.GetProperty("processId").GetInt32();if(pid!=previous)return pid;
}catch{}await Task.Delay(250);}throw new IOException("SCM backend did not become ready. "+(File.Exists(Path.Combine(root,"logs/service.log"))?File.ReadAllText(Path.Combine(root,"logs/service.log")):"No log"));}
bool failed=false;
try {
    // Create the registration first so a test-only environment is set before start.
    string host=Path.Combine(root,".service","SoftechService.exe");
    ServerService.Command("create",ServerService.Name,"binPath=",$"\"{host}\" --service \"{root}\"","start=","demand","obj=",@"NT AUTHORITY\LocalService");
    using(var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\"+ServerService.Name,true))
        key!.SetValue("Environment",new[]{"NODE_ENV=test","PORT="+port,"SOFTECH_CLOUD_URL=http://127.0.0.1:9","UPDATE_MANIFEST_URL=http://127.0.0.1:9"},RegistryValueKind.MultiString);
    ServiceInstallation.Install(root);
    int first=await Ready();using(var node=Process.GetProcessById(first)){
        if(node.SessionId!=0||!string.Equals(node.MainModule?.FileName,Path.Combine(root,"runtime","node.exe"),StringComparison.OrdinalIgnoreCase))throw new Exception("Backend is not owned by the service in Session 0");
        node.Kill();await node.WaitForExitAsync();
    }
    int restarted=await Ready(first);
    using var restartedProcess=Process.GetProcessById(restarted);
    ServerService.StopAndWait(root);
    ServerService.StopAndWait(root); // Already stopped is a successful no-op.
    if(!restartedProcess.HasExited)throw new Exception("Owned backend process survived SCM stop: "+restarted);
    if(!File.ReadAllText(Path.Combine(root,"logs","service.log")).Contains("SCM shutdown completed."))
        throw new Exception("SCM reported stopped without completing managed shutdown");
    await StoppedBackendProbe.Verify(restartedProcess.HasExited,async()=>{
        using var response=await http.GetAsync($"http://127.0.0.1:{port}/api/health");
        // Any HTTP response, even 503/404, proves an endpoint still responds.
    });
    ServerService.Command("start",ServerService.Name);await Ready();
    ServerService.StopAndWait(root);
    ServerService.Command("start",ServerService.Name);
    // Exercise STOP while SCM may still be transitioning out of START_PENDING.
    ServerService.StopAndWait(root);
    ServerService.Command("start",ServerService.Name);await Ready();
    Console.WriteLine("PASS actual SCM registration, LocalService ACL, Session 0, crash restart, graceful stop and start without a cashier window");
}catch(Exception error){
    failed=true;
    Console.Error.WriteLine("SCM lifecycle failure: "+error);
    string log=Path.Combine(root,"logs","service.log");
    if(File.Exists(log))Console.Error.WriteLine(string.Join(Environment.NewLine,File.ReadLines(log).TakeLast(80)));
    throw;
}finally{
    try{if(ServerService.Installed(root)){ServerService.StopAndWait(root);ServerService.Command("delete",ServerService.Name);}}
    catch(Exception error)when(failed){Console.Error.WriteLine("SCM cleanup also failed; original failure preserved: "+error);}
    var netsh=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"netsh.exe")){UseShellExecute=false,CreateNoWindow=true};
    foreach(var value in new[]{"advfirewall","firewall","delete","rule","name=Softech Server Service"})netsh.ArgumentList.Add(value);
    using var cleanup=Process.Start(netsh);cleanup?.WaitForExit(30000);
}
