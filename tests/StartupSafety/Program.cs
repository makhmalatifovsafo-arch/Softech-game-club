using System.Net;
using System.Text.Json.Nodes;
using ClientSetup;
using SoftechCockpit;
using Softech.Security;

static void Check(bool condition, string label)
{
    if (!condition) throw new Exception(label);
}
static void Reject(Action action, string label)
{
    try { action(); }
    catch (ArgumentException) { return; }
    catch (System.Text.Json.JsonException) { return; }
    throw new Exception(label);
}

var fresh = JsonNode.Parse(ClientSetupConfiguration.Merge(null, "ws://192.168.1.10:5000/ws", "VIP-01"))!;
var simple = JsonNode.Parse(ClientSetupConfiguration.Merge(null, " 192.168.199.10 ", "PC-01"))!;
Check(simple["serverUrl"]!.GetValue<string>() == "ws://192.168.199.10:5000/ws", "Bare server IP must become a complete WebSocket URL");
Check(Softech.Networking.ServerAddress.Display(simple["serverUrl"]!.GetValue<string>()) == "192.168.199.10", "Settings must show just the default server IP");
foreach (var custom in new[] { "ws://192.168.199.10:6000/ws", "wss://server.example/ws" })
{
    Check(Softech.Networking.ServerAddress.Normalize(custom) == custom, "Custom transport and port must survive");
    Check(Softech.Networking.ServerAddress.Display(custom) == custom, "Custom addresses must not lose transport or port");
}
foreach (var invalid in new[] { "192.168.199.999", "192.168.199", "192.168.199.10/other", "192.168.199.10:5000", "hello world" })
    Reject(() => ClientSetupConfiguration.Merge(null, invalid, "PC-01"), "Invalid IP accepted: " + invalid);
Check(fresh["pcNumber"]!.GetValue<string>() == "VIP-01", "Workstation ID must retain its full name");
Check(fresh["updateIdleSeconds"]!.GetValue<int>() == 10, "New installs must use 10-second update idle");
var old = """{"serverUrl":"ws://old:5000/ws","pcNumber":"OLD","workstationName":"OLD","heartbeatIntervalSeconds":8,"updateIdleSeconds":10,"updateUrl":"https://example.test/version.json","custom":{"enabled":true}}""";
var updated = JsonNode.Parse(ClientSetupConfiguration.Merge(old, "wss://new.example.test/ws", "PC-02"))!;
Check(updated["serverUrl"]!.GetValue<string>() == "wss://new.example.test/ws", "Reinstall must apply the selected server address");
Check(updated["pcNumber"]!.GetValue<string>() == "PC-02" && updated["workstationName"]!.GetValue<string>() == "PC-02", "Reinstall must apply the selected workstation name");
Check(updated["heartbeatIntervalSeconds"]!.GetValue<int>() == 8 && updated["custom"]!["enabled"]!.GetValue<bool>(), "Existing settings must survive reinstall");
Check(updated["updateUrl"]!.GetValue<string>() == "https://example.test/version.json", "Update feed must survive reinstall");
foreach (var address in new[] { "", "http://server:5000/ws", "ws://server:5000/", "ws://user:password@server/ws", "ws://server/ws#fragment", "ws://server/ws?query=1" })
    Reject(() => ClientSetupConfiguration.Merge(null, address, "PC-01"), "Invalid address accepted: " + address);
foreach (var previous in new[] { "[]", "null", "broken json" })
    Reject(() => ClientSetupConfiguration.Merge(previous, "ws://server:5000/ws", "PC-01"), "Broken settings silently replaced");
Reject(() => ClientSetupConfiguration.Merge(null, "ws://server:5000/ws", " "), "Empty name accepted");

// Offline emergency access has no shared/default password and survives normal reconfiguration.
const string ownerPassword = "test-only owner password";
var configured = EmergencyPassword.Configure(fresh.ToJsonString(), "", ownerPassword, ownerPassword);
var verifier = JsonNode.Parse(configured)!["emergencyAccess"];
Check(!configured.Contains(ownerPassword), "Plaintext emergency password was stored");
Check(EmergencyPassword.Verify(verifier, ownerPassword), "Owner password rejected");
Check(!EmergencyPassword.Verify(verifier, "manager") && !EmergencyPassword.Verify(null, ownerPassword), "Unconfigured/default access accepted");
Check(!EmergencyPassword.Verify(JsonNode.Parse("{}"), ownerPassword), "Damaged verifier accepted");
Check(!EmergencyPassword.Verify(verifier, ownerPassword.ToUpperInvariant()), "Password must be case-sensitive");
Check(verifier!["salt"]!.ToString() != EmergencyPassword.Create(ownerPassword)["salt"]!.ToString(), "Salt must be random per installation");
Reject(() => EmergencyPassword.Configure(fresh.ToJsonString(), "", "", ""), "First install without password accepted");
Reject(() => EmergencyPassword.Configure(fresh.ToJsonString(), "", "1234", "1234"), "Short emergency password accepted");
Reject(() => EmergencyPassword.Configure(configured, "wrong", "new-owner-password", "new-owner-password"), "Unauthorized reset accepted");
Reject(() => EmergencyPassword.Configure(configured, ownerPassword, "new-owner-password", "mismatch"), "Mismatched confirmation accepted");
var reinstalled = ClientSetupConfiguration.Merge(configured, "ws://new-server:5000/ws", "PC-10");
Check(EmergencyPassword.Verify(JsonNode.Parse(reinstalled)!["emergencyAccess"], ownerPassword), "Reinstall lost emergency access");
Check(EmergencyPassword.Configure(reinstalled, ownerPassword, "", "") == reinstalled, "Reinstall should keep the existing verifier");
var rotated = JsonNode.Parse(EmergencyPassword.Configure(configured, ownerPassword, "new-owner-password", "new-owner-password"))!["emergencyAccess"];
Check(EmergencyPassword.Verify(rotated, "new-owner-password") && !EmergencyPassword.Verify(rotated, ownerPassword), "Password rotation failed");
Console.WriteLine("PASS: emergency password hashing, fail-closed validation, provisioning, rotation and reinstall preservation");

var cases = new (HttpStatusCode Status, string Body, bool Expected)[]
{
    (HttpStatusCode.OK, "<html>Another application</html>", false),
    (HttpStatusCode.OK, """{"app":"OtherApp","status":"ok"}""", false),
    (HttpStatusCode.OK, """{"app":"NetCafeServer","status":"error"}""", false),
    (HttpStatusCode.OK, """{"app":1,"status":"ok"}""", false),
    (HttpStatusCode.OK, "[]", false),
    (HttpStatusCode.OK, """{"app":"NetCafeServer","status":"ok"}""", true),
    (HttpStatusCode.ServiceUnavailable, """{"app":"NetCafeServer","status":"ok"}""", false)
};
foreach (var item in cases)
{
    using var handler = new HealthHandler(item.Status, item.Body);
    using var client = new HttpClient(handler);
    Check(await new NodeProcessManager(client).IsServerHealthyAsync() == item.Expected, "Incorrect health result: " + item.Body);
    Check(handler.Calls == 1, "Must never fall back to another application's root page");
}
using (var handler = new HealthHandler(HttpStatusCode.OK, "", fail: true))
using (var client = new HttpClient(handler))
    Check(!await new NodeProcessManager(client).IsServerHealthyAsync(), "Unavailable backend reported healthy");
Console.WriteLine("PASS: client installation/reconfiguration validation and launcher health identity checks");

// Error code alone cannot diagnose a failed remote installation.
var diagnostics = new NodeProcessManager();
var diagnosticFlags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
var capture = typeof(NodeProcessManager).GetMethod("CaptureError", diagnosticFlags)!;
var failure = typeof(NodeProcessManager).GetMethod("StartupFailure", diagnosticFlags)!;
var fixturePath = Path.GetFullPath(Path.Combine(".test-output", "launcher-errors-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(fixturePath);
capture.Invoke(diagnostics, new object?[] { null });
capture.Invoke(diagnostics, new object?[] { new string('x', 20000) });
capture.Invoke(diagnostics, new object?[] { "Error: ERR_MODULE_NOT_FOUND: fixture-missing-module" });
var diagnosticText = (string)failure.Invoke(diagnostics, new object[] { 1, fixturePath })!;
Check(diagnosticText.Contains("fixture-missing-module"), "Actual Node error lost");
Check(diagnosticText.Length < 13000, "Startup error is unbounded");
var diagnosticLog = Path.Combine(fixturePath, "logs", "node-startup-error.log");
Check(File.ReadAllText(diagnosticLog).Contains("ERR_MODULE_NOT_FOUND"), "Startup error not persisted");
Console.WriteLine("PASS: actual startup error visible and persisted with bounded output");

var recoveryTime = DateTimeOffset.UtcNow;
bool suspended = true, crashed = true;
int restarts = 0, reports = 0;
var recovering = new TaskCompletionSource();
var recovery = new BackendRecovery(() => crashed, () => suspended, async () => {
    restarts++;
    if (restarts == 1) await recovering.Task;
    throw new IOException("fixture crash");
}, _ => reports++, () => recoveryTime);
await recovery.TickAsync(); Check(restarts == 0, "Must not race an update or shutdown");
suspended = false;
var firstRecovery = recovery.TickAsync();
await recovery.TickAsync(); Check(restarts == 1, "Concurrent recovery spawned twice");
recovering.SetResult(); await firstRecovery;
await recovery.TickAsync(); Check(restarts == 1, "Crash loop has no delay");
for (int i=0; i<4; i++) { recoveryTime = recoveryTime.AddSeconds(11); await recovery.TickAsync(); }
Check(restarts == 3 && reports == 4, "Recovery must stop after three attempts and report exhaustion once");
recoveryTime = recoveryTime.AddMinutes(6);
crashed = false; await recovery.TickAsync(); Check(restarts == 3, "A healthy/hung/external server must never be restarted");
crashed = true; await recovery.TickAsync(); Check(restarts == 4, "Recovery window never reopened");
Console.WriteLine("PASS: recovery excludes updates, serializes attempts, bounds crash loops and never kills a live backend");

// Real child process, isolated files, no listening port and no production database.
var nodeExe = Environment.GetEnvironmentVariable("SOFTECH_TEST_NODE") ??
    Environment.GetEnvironmentVariable("PATH")!.Split(Path.PathSeparator)
        .Select(dir => Path.Combine(dir, OperatingSystem.IsWindows() ? "node.exe" : "node"))
        .First(File.Exists);
var processFixture = Path.GetFullPath(Path.Combine(".test-output", "launcher-process-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(Path.Combine(processFixture, "src"));
File.WriteAllText(Path.Combine(processFixture, "package.json"), """{"type":"commonjs"}""");
File.WriteAllText(Path.Combine(processFixture, "src", "server.js"), """
    const fs=require('node:fs');
    fs.appendFileSync('starts.txt', process.pid+'\n');
    setTimeout(()=>fs.writeFileSync('ready', 'yes'), 600);
    setInterval(()=>{
      if(fs.existsSync('crash')){
        fs.unlinkSync('crash'); fs.rmSync('ready',{force:true});
        console.error('Error: fixture-backend-crashed'); process.exit(1);
      }
    }, 20);
    """);
using var fixtureHttp = new HttpClient(new FileHealthHandler(Path.Combine(processFixture, "ready")));
var processManager = new NodeProcessManager(fixtureHttp) {
    ResolvePaths = () => (nodeExe, processFixture), PortIsBusy = () => false,
    StartupTimeout = TimeSpan.FromMilliseconds(100)
};
try {
    bool timedOut = false;
    try { await processManager.EnsureServerRunningAsync(); }
    catch (TimeoutException) { timedOut = true; }
    Check(timedOut && processManager.IsRunning, "Readiness timeout killed initialization");
    processManager.StartupTimeout = TimeSpan.FromSeconds(10);
    var waits = await Task.WhenAll(processManager.EnsureServerRunningAsync(), processManager.EnsureServerRunningAsync());
    Check(waits.All(result => result), "Retry did not wait for existing initialization");
    Check(File.ReadAllLines(Path.Combine(processFixture,"starts.txt")).Length == 1, "Retry spawned a duplicate backend");
    File.WriteAllText(Path.Combine(processFixture,"crash"), "1");
    for(int i=0;i<200&&!processManager.HasUnexpectedExit;i++) await Task.Delay(20);
    Check(processManager.HasUnexpectedExit, "Backend exit was not detected");
    Check(processManager.GetExitDiagnostic().Contains("fixture-backend-crashed"), "Runtime crash diagnostic lost");
    var realRecovery = new BackendRecovery(() => processManager.HasUnexpectedExit, () => false,
        async () => { Check(await processManager.EnsureServerRunningAsync(), "Recovery failed"); }, message => throw new Exception(message));
    await realRecovery.TickAsync();
    Check(processManager.IsRunning && File.ReadAllLines(Path.Combine(processFixture,"starts.txt")).Length == 2,
        "Backend did not recover exactly once");
} finally { processManager.StopNodeServer(); }
Console.WriteLine("PASS: real slow startup survives timeout and concurrent retries; crashed backend restarts with actual diagnostics");

sealed class FileHealthHandler(string readyFile) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        => Task.FromResult(new HttpResponseMessage(File.Exists(readyFile) ? HttpStatusCode.OK : HttpStatusCode.ServiceUnavailable) {
            Content = new StringContent("""{"app":"NetCafeServer","status":"ok"}""") });
}

sealed class HealthHandler(HttpStatusCode status, string body, bool fail = false) : HttpMessageHandler
{
    public int Calls { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        if (request.RequestUri!.ToString() != NodeProcessManager.HealthCheckUrl) throw new Exception("Unexpected health endpoint");
        if (fail) throw new HttpRequestException("Offline fixture");
        return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
    }
}
