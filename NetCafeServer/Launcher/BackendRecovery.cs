using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace SoftechCockpit;

// Restart only a backend we launched and observed exiting. Never kill an
// unresponsive process: it may be committing a payment or running a migration.
public sealed class BackendRecovery(Func<bool> needsRecovery, Func<bool> suspended,
    Func<Task> recover, Action<string> report, Func<DateTimeOffset>? clock = null)
{
    private readonly Queue<DateTimeOffset> attempts = new();
    private bool busy;
    private bool notified;
    private DateTimeOffset nextAttempt;
    public async Task TickAsync()
    {
        if (busy || suspended() || !needsRecovery()) return;
        var now = (clock ?? (() => DateTimeOffset.UtcNow))();
        while (attempts.Count > 0 && now - attempts.Peek() >= TimeSpan.FromMinutes(5)) attempts.Dequeue();
        if (attempts.Count >= 3) {
            if (!notified) report("Server qayta-qayta to'xtamoqda. Avtomatik urinishlar vaqtincha to'xtatildi; xato logini tekshirish kerak.");
            notified = true;
            return;
        }
        if (now < nextAttempt) return;
        busy = true;
        notified = false;
        attempts.Enqueue(now);
        nextAttempt = now.AddSeconds(10);
        try { await recover(); }
        catch (Exception error) { report(error.Message); }
        finally { busy = false; }
    }
}
