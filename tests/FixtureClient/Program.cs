using System.Diagnostics;
File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "running.pid"), Environment.ProcessId.ToString());
if (File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "behavior.txt")).Trim() == "fail") return 42;
int index = Array.IndexOf(args, "--update-health");
if (index >= 0) File.WriteAllText(args[index + 1], "ready");
await Task.Delay(Timeout.Infinite);
return 0;
