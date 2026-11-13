using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Threading;
using Softech.Updates;

namespace SoftechCockpit;

public sealed class UpdateMonitor : IDisposable
{
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly string serverDirectory;
    private readonly Action exit;
    public bool IsUpdateShutdown { get; private set; }
    private DateTimeOffset nextPulse;
    private string PresenceFile => Path.Combine(serverDirectory,"data","cockpit-"+Environment.ProcessId+".json");

    public UpdateMonitor(string serverDirectory, Action exit)
    {
        this.serverDirectory = serverDirectory;
        this.exit = exit;
        timer.Tick += Tick;
        timer.Start();
    }

    private void Tick(object? sender, EventArgs args)
    {
        if(ServerService.Installed(serverDirectory)&&DateTimeOffset.UtcNow>=nextPulse) {
            nextPulse=DateTimeOffset.UtcNow.AddSeconds(2);
            try { UpdateJournal.Write(PresenceFile,new{pid=Environment.ProcessId,at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),idleSeconds=IdleSafety.IdleSeconds()}); } catch { }
        }
        if (!HasPendingHandover()) return;
        IsUpdateShutdown = true;
        timer.Stop();
        exit();
    }

    public bool HasPendingHandover()
    {
        try
        {
            string marker = Path.Combine(serverDirectory, "updates", "cockpit-exit.json");
            if (!File.Exists(marker)) return false;
            using var doc = JsonDocument.Parse(File.ReadAllText(marker));
            bool service=doc.RootElement.TryGetProperty("service",out var flag)&&flag.ValueKind==JsonValueKind.True&&ServerService.Installed(serverDirectory);
            if (!service&&doc.RootElement.GetProperty("pid").GetInt32() != Environment.ProcessId) return false;
            long at = doc.RootElement.GetProperty("at").GetInt64();
            long age = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - at;
            return age >= 0 && age <= 60000;
        }
        catch { /* Atomic file writes can be observed briefly before completion. */ }
        return false;
    }

    public void Dispose() {timer.Stop();try{File.Delete(PresenceFile);}catch{}}
}
