using System;
using System.IO;
using System.Security.Principal;
using System.Runtime.InteropServices;

namespace ClientSetup;

internal static class ClientAutoStart
{
    public static void Configure(string directory, bool enabled, bool validateOnly = false)
    {
        if (validateOnly && !enabled) throw new ArgumentException("Validation requires an enabled task.");
        using var identity = WindowsIdentity.GetCurrent();
        if (!validateOnly && !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("Avtomatik kiosk uchun setupni administrator sifatida oching.");
        string sid = identity.User!.Value;
        string name = "SoftechClientKiosk-" + sid;
        dynamic service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service")
            ?? throw new InvalidOperationException("Windows Task Scheduler mavjud emas."))!;
        service.Connect();
        dynamic folder = service.GetFolder("\\");
        if (enabled)
        {
            string executable = Path.Combine(Path.GetFullPath(directory), "NetCafeClient.exe");
            if (!File.Exists(executable)) throw new FileNotFoundException("Client topilmadi.", executable);
            dynamic task = service.NewTask(0);
            task.RegistrationInfo.Description = "Softech kiosk: lock screen at Windows user logon.";
            task.Principal.UserId = sid;
            task.Principal.LogonType = 3; // InteractiveToken: visible in this user's desktop, no password stored.
            task.Principal.RunLevel = 1; // Highest: consent is given once by the elevated installer.
            dynamic trigger = task.Triggers.Create(9); // Logon, without delay or network dependency.
            trigger.UserId = sid;
            task.Settings.Enabled = true;
            task.Settings.DisallowStartIfOnBatteries = false;
            task.Settings.StopIfGoingOnBatteries = false;
            task.Settings.RunOnlyIfNetworkAvailable = false;
            task.Settings.ExecutionTimeLimit = "PT0S";
            task.Settings.MultipleInstances = 2; // IgnoreNew
            task.Settings.AllowDemandStart = true;
            dynamic action = task.Actions.Create(0);
            action.Path = executable;
            action.WorkingDirectory = Path.GetFullPath(directory);
            folder.RegisterTaskDefinition(name, task, validateOnly ? 1 : 6, sid, null, 3, null);
        }
        else
        {
            try { folder.DeleteTask(name, 0); }
            catch (COMException error) when (error.HResult == unchecked((int)0x80070002)) { }
        }
        // Remove the old startup entry only after the replacement is registered.
        if (validateOnly) return;
        string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "SoftechClientKiosk.lnk");
        if (File.Exists(legacy)) File.Delete(legacy);
    }
}
