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
