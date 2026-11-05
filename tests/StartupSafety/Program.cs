using System.Net;
using System.Text.Json.Nodes;
using ClientSetup;
using SoftechCockpit;

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
