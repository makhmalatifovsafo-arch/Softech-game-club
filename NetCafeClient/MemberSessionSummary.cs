using System;
using System.Text.Json;

namespace NetCafeClient;

public sealed record MemberSessionSummary(string SessionId, string Username, long AccountId,
    double PlayedMinutes, double GameAmount, double RefundAmount, double Balance, double BarDebt)
{
    public static MemberSessionSummary? Parse(JsonElement value)
    {
        try
        {
            var summary = value.Deserialize<MemberSessionSummary>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (summary == null || string.IsNullOrEmpty(summary.SessionId) || string.IsNullOrEmpty(summary.Username) || summary.AccountId <= 0) return null;
            foreach (var amount in new[] { summary.PlayedMinutes, summary.GameAmount, summary.RefundAmount, summary.Balance, summary.BarDebt })
                if (!double.IsFinite(amount) || amount < 0) return null;
            return summary;
        }
        catch (JsonException) { return null; }
    }
}
