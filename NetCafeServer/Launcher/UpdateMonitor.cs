using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Threading;

namespace SoftechCockpit;

public sealed class UpdateMonitor : IDisposable
{
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly string serverDirectory;
    private readonly Action exit;
    public bool IsUpdateShutdown { get; private set; }

    public UpdateMonitor(string serverDirectory, Action exit)
    {
        this.serverDirectory = serverDirectory;
        this.exit = exit;
        timer.Tick += Tick;
        timer.Start();
    }

    private void Tick(object? sender, EventArgs args)
    {
        try
        {
            string marker = Path.Combine(serverDirectory, "updates", "cockpit-exit.json");
            if (!File.Exists(marker)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(marker));
            if (doc.RootElement.GetProperty("pid").GetInt32() != Environment.ProcessId) return;
            long at = doc.RootElement.GetProperty("at").GetInt64();
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - at > 60000) return;
            IsUpdateShutdown = true;
            timer.Stop();
            exit();
        }
        catch { /* Atomic file writes can be observed briefly before completion. */ }
    }

    public void Dispose() => timer.Stop();
}
