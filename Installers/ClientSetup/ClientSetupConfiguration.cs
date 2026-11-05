using System;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ClientSetup;

public static class ClientSetupConfiguration
{
    public static string Merge(string? previous, string serverUrl, string workstation)
    {
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "ws" && uri.Scheme != "wss") || string.IsNullOrWhiteSpace(uri.Host) ||
            uri.AbsolutePath != "/ws" || !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Fragment) || !string.IsNullOrEmpty(uri.Query))
            throw new ArgumentException("Server manzilini ws://SERVER_IP:5000/ws shaklida kiriting.");
        if (string.IsNullOrWhiteSpace(workstation)) throw new ArgumentException("Stol nomini kiriting.");
        var config = previous == null ? new JsonObject() :
            JsonNode.Parse(previous) as JsonObject ?? throw new ArgumentException("Mavjud config.json yaroqsiz. Uni tekshiring.");
        config["serverUrl"] = serverUrl;
        config["pcNumber"] = workstation;
        config["workstationName"] = workstation;
        config["heartbeatIntervalSeconds"] ??= 5;
        config["updateIdleSeconds"] ??= 10;
        return config.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}
