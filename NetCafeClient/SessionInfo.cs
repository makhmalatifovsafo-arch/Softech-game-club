using System;
using System.Text.Json;

namespace NetCafeClient;

public sealed record SessionInfo(string SessionId, bool IsPostpaid, bool CanSelfClose,
    long StartedAt, long AsOf, double? GameAmount, string? BillingError)
{
    public static SessionInfo? Parse(JsonElement data)
    {
        try
        {
            if (!data.TryGetProperty("sessionInfo", out var value)) return null;
            var info = value.Deserialize<SessionInfo>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (info == null || string.IsNullOrEmpty(info.SessionId) || info.StartedAt <= 0 || info.AsOf < info.StartedAt ||
                info.AsOf > 253402300799999 || (info.GameAmount is double amount && (!double.IsFinite(amount) || amount < 0))) return null;
            return info;
        }
        catch (JsonException) { return null; }
    }
}
