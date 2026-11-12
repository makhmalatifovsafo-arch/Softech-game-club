using ClientSetup;
// Windows validates the actual generated task without registering it or launching a kiosk.
string root = Path.GetFullPath(Path.Combine(".test-output", "autostart-" + Guid.NewGuid()));
Directory.CreateDirectory(root);
File.WriteAllText(Path.Combine(root, "NetCafeClient.exe"), "validation fixture only");
ClientAutoStart.Configure(root, true, validateOnly: true);
Console.WriteLine("PASS Windows Task Scheduler validates interactive elevated client logon task (no task installed)");
