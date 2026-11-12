using System;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ClientSetup;

public static class ClientSetupConfiguration
{
    public static string Merge(string? previous, string serverUrl, string workstation)
    {
        serverUrl = Softech.Networking.ServerAddress.Normalize(serverUrl);
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
