using System.IO;
using System.Text.Json.Nodes;
using Softech.Security;

namespace NetCafeClient;

public sealed class EmergencyAccessGuard
{
    private int _failures;
    private long _retryAfter;
    private readonly object _gate = new();

    // This object lives for the lifetime of the lock window; closing the modal cannot reset attempts.
    public string? Authenticate(string configPath, string password)
    {
        lock (_gate)
        {
            long now = Environment.TickCount64;
            if (now < _retryAfter)
                return $"Ko‘p noto‘g‘ri urinish. {(_retryAfter - now + 999) / 1000} soniyadan keyin urinib ko‘ring.";
            bool accepted = false;
            try
            {
                var config = JsonNode.Parse(File.ReadAllText(configPath));
                accepted = EmergencyPassword.Verify(config?["emergencyAccess"], password);
            }
            catch { /* Fail closed, including missing/unreadable config. */ }
            if (accepted) { _failures = 0; return null; }
            if (++_failures >= 5) { _retryAfter = now + 30_000; _failures = 0; }
            return "Favqulodda chiqish paroli noto‘g‘ri yoki hali sozlanmagan.";
        }
    }
}
