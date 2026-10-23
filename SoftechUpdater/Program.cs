using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace SoftechUpdater;

/// <summary>
/// SoftechUpdater — Enterprise Companion Process for NetCafeClient OTA Updates.
/// Vazifalari:
/// 1. Windows 'File in Use' cheklovini yechish (Running .exe ni almashtirish).
/// 2. Parent PID (NetCafeClient) ning to'liq yopilishini kutish (Process.WaitForExit).
/// 3. Eski fayllarni .bak ga xavfsiz zaxiralash.
/// 4. Yangi fayllarni nusxalash (workstation config.json saqlanadi).
/// 5. Yangilangan NetCafeClient.exe ni administrator huquqlari bilan qayta yoqish.
/// 6. 10 soniyalik Crash Watchdog & Rollback Guard (agar yangi fayl ishlamay qolsa, .bak zudlik bilan tiklanadi).
/// 7. Staging katalogini tozalash.
/// </summary>
public static class Program
{
    private static readonly string _logFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SoftechClient",
        "updater.log"
    );

    public static int Main(string[] args)
    {
        EnsureLogDirectory();
        Log("=================================================");
        Log($"🚀 [SoftechUpdater] Ishga tushirildi. Argumentlar: {string.Join(" ", args)}");

        string? sourceDir = null;
        string? targetDir = null;
        int parentPid = -1;
        string exeName = "NetCafeClient.exe";
        int waitTimeoutSeconds = 15;

        // Argumentlarni o'qish (--target, --source, --pid, --restart, --executable, --timeout)
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg.Equals("--source", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                sourceDir = args[++i];
            }
            else if (arg.Equals("--target", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                targetDir = args[++i];
            }
            else if (arg.Equals("--pid", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                int.TryParse(args[++i], out parentPid);
            }
            else if ((arg.Equals("--restart", StringComparison.OrdinalIgnoreCase) || 
                      arg.Equals("--executable", StringComparison.OrdinalIgnoreCase)) && i + 1 < args.Length)
            {
                exeName = args[++i];
            }
            else if (arg.Equals("--timeout", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                int.TryParse(args[++i], out waitTimeoutSeconds);
            }
        }

        if (string.IsNullOrWhiteSpace(sourceDir) || !Directory.Exists(sourceDir))
        {
            Log($"❌ [SoftechUpdater] Noto'g'ri source katalogi: '{sourceDir}'");
            return 1;
        }

        if (string.IsNullOrWhiteSpace(targetDir) || !Directory.Exists(targetDir))
        {
            Log($"❌ [SoftechUpdater] Noto'g'ri target katalogi: '{targetDir}'");
            return 2;
        }

        // 1. Asosiy mijoz jarayoni (Parent PID) to'xtashini kutish
        if (parentPid > 0)
        {
            Log($"⏳ Asosiy jarayon (PID: {parentPid}) yopilishi kutilmoqda (maksimal {waitTimeoutSeconds}s)...");
            try
            {
                var parentProc = Process.GetProcessById(parentPid);
                if (!parentProc.WaitForExit(waitTimeoutSeconds * 1000))
                {
                    Log($"⚠️ Asosiy jarayon belgilangan vaqtda yopilmadi. Majburiy to'xtatilmoqda...");
                    parentProc.Kill();
                    parentProc.WaitForExit(3000);
                }
            }
            catch (ArgumentException)
            {
                Log($"ℹ️ Asosiy jarayon (PID: {parentPid}) allaqachon to'xtagan.");
            }
            catch (Exception ex)
            {
                Log($"⚠️ Jarayonni kutishda ogohlantirish: {ex.Message}");
            }
        }

        // Qolib ketgan NetCafeClient nusxalarini xavfsiz to'xtatish
        TerminateRunningTargetProcesses(targetDir, exeName);

        // Watchdog xavfsiz chiqish fayli mavjud bo'lsa tozalash
        string gracefulExitMarker = Path.Combine(targetDir, ".graceful_exit");
        try
        {
            if (File.Exists(gracefulExitMarker))
            {
                File.Delete(gracefulExitMarker);
            }
        }
        catch { }

        // 2. Mavjud ijro faylini zaxiralash (.bak)
        string targetExePath = Path.Combine(targetDir, exeName);
        string bakExePath = targetExePath + ".bak";

        try
        {
            if (File.Exists(targetExePath))
            {
                Log($"📦 Zaxira nusxa yaratilmoqda: {targetExePath} -> {bakExePath}");
                File.Copy(targetExePath, bakExePath, overwrite: true);
            }
        }
        catch (Exception ex)
        {
            Log($"⚠️ Ogohlantirish: .bak yaratib bo'lmadi: {ex.Message}");
        }

        // 3. Staging katalogidagi fayllarni target katalogiga nusxalash
        Log($"📂 Yangilanish fayllari ko'chirilmoqda: '{sourceDir}' -> '{targetDir}'...");
        bool copySuccess = CopyDirectory(sourceDir, targetDir);

        if (!copySuccess)
        {
            Log("❌ [SoftechUpdater] Fayllarni nusxalashda xatolik yuz berdi! Zaxiradan tiklanmoqda (Rollback)...");
            RestoreBackup(bakExePath, targetExePath);
            LaunchProcess(targetExePath, targetDir, requireAdmin: true);
            return 3;
        }

        Log("✅ Barcha fayllar muvaffaqiyatli yangilandi.");

        // 4. Sog'lomlik tekshiruvi & 10 soniyalik Crash Watchdog (Rollback Guard)
        Log($"🚀 Yangilangan '{targetExePath}' administrator huquqlari bilan ishga tushirilmoqda...");
        Process? newProc = LaunchProcess(targetExePath, targetDir, requireAdmin: true);

        if (newProc == null)
        {
            Log("❌ Yangi dasturni ishga tushirib bo'lmadi! Zudlik bilan eski versiya tiklanmoqda...");
            RestoreBackup(bakExePath, targetExePath);
            LaunchProcess(targetExePath, targetDir, requireAdmin: true);
            return 4;
        }

        bool crashed = false;
        int checkIntervalMs = 500;
        int totalChecks = 20; // 20 * 500ms = 10 soniya barqarorlik tekshiruvi

        for (int i = 0; i < totalChecks; i++)
        {
            Thread.Sleep(checkIntervalMs);
            if (newProc.HasExited)
            {
                Log($"💥 KRITIK XATOLIK: Yangi versiya 10 soniya ichida kutilmaganda yopildi! ExitCode: {newProc.ExitCode}");
                crashed = true;
                break;
            }
        }

        if (crashed)
        {
            Log("🔄 Avtomatik Rollback: Oldingi barqaror versiya (.bak) tiklanmoqda...");
            RestoreBackup(bakExePath, targetExePath);
            Log("🚀 Zaxiradagi versiya qayta yoqilmoqda...");
            LaunchProcess(targetExePath, targetDir, requireAdmin: true);
            Log("⚠️ Rollback to'liq yakunlandi. Workstation ish holatiga qaytarildi.");
            return 5;
        }

        Log("🎉 10 soniyalik sog'lomlik tekshiruvi muvaffaqiyatli o'tdi! Yangi versiya barqaror ishlamoqda.");

        // 5. Staging katalogini tozalash
        try
        {
            Directory.Delete(sourceDir, recursive: true);
            Log("🧹 Staging katalogi tozalandi.");
        }
        catch (Exception ex)
        {
            Log($"ℹ️ Staging tozalash keyinga qoldirildi: {ex.Message}");
        }

        Log("🏁 [SoftechUpdater] Yangilanish jarayoni muvaffaqiyatli yakunlandi.");
        return 0;
    }

    private static void TerminateRunningTargetProcesses(string targetDir, string exeName)
    {
        string processNameWithoutExt = Path.GetFileNameWithoutExtension(exeName);
        foreach (var proc in Process.GetProcessesByName(processNameWithoutExt))
        {
            try
            {
                string? procPath = proc.MainModule?.FileName;
                if (procPath != null && procPath.StartsWith(targetDir, StringComparison.OrdinalIgnoreCase))
                {
                    Log($"🛑 Eski jarayon to'xtatilmoqda: PID {proc.Id} ({procPath})");
                    proc.Kill();
                    proc.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    private static bool CopyDirectory(string source, string target)
    {
        try
        {
            foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                string relativePath = Path.GetRelativePath(source, file);
                string destinationFile = Path.Combine(target, relativePath);

                // Workstation konfiguratsiyasi (config.json) mavjud bo'lsa, ustidan yozmaymiz
                if (Path.GetFileName(file).Equals("config.json", StringComparison.OrdinalIgnoreCase) &&
                    File.Exists(destinationFile))
                {
                    Log($"🔒 Workstation konfiguratsiyasi saqlab qolindi: {destinationFile}");
                    continue;
                }

                string? destDir = Path.GetDirectoryName(destinationFile);
                if (destDir != null && !Directory.Exists(destDir))
                {
                    Directory.CreateDirectory(destDir);
                }

                // Fayl vaqtincha bloklangan bo'lsa 5 martagacha qayta urinish
                bool copied = false;
                for (int attempt = 1; attempt <= 5; attempt++)
                {
                    try
                    {
                        File.Copy(file, destinationFile, overwrite: true);
                        copied = true;
                        break;
                    }
                    catch (IOException)
                    {
                        Thread.Sleep(500);
                    }
                }

                if (!copied)
                {
                    Log($"❌ Faylni ko'chirib bo'lmadi: {file} -> {destinationFile}");
                    return false;
                }
            }
            return true;
        }
        catch (Exception ex)
        {
            Log($"❌ CopyDirectory Xatosi: {ex.Message}");
            return false;
        }
    }

    private static void RestoreBackup(string bakPath, string targetExePath)
    {
        try
        {
            if (File.Exists(bakPath))
            {
                File.Copy(bakPath, targetExePath, overwrite: true);
                Log($"✓ Zaxira tiklandi: {bakPath} -> {targetExePath}");
            }
        }
        catch (Exception ex)
        {
            Log($"❌ Zaxirani tiklashda xatolik: {ex.Message}");
        }
    }

    private static Process? LaunchProcess(string exePath, string workingDir, bool requireAdmin = true)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exePath,
                WorkingDirectory = workingDir,
                UseShellExecute = true
            };
            if (requireAdmin)
            {
                psi.Verb = "runas"; // Administrator huquqlari
            }
            return Process.Start(psi);
        }
        catch (Exception ex)
        {
            Log($"⚠️ Administrator huquqi (runas) bilan yoqishda xatolik: {ex.Message}. Oddiy rejimda urinib ko'rilmoqda...");
            try
            {
                var fallbackPsi = new ProcessStartInfo
                {
                    FileName = exePath,
                    WorkingDirectory = workingDir,
                    UseShellExecute = true
                };
                return Process.Start(fallbackPsi);
            }
            catch (Exception ex2)
            {
                Log($"❌ Dasturni ishga tushirishda xatolik '{exePath}': {ex2.Message}");
                return null;
            }
        }
    }

    private static void EnsureLogDirectory()
    {
        try
        {
            string? dir = Path.GetDirectoryName(_logFile);
            if (dir != null && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
        }
        catch { }
    }

    private static void Log(string message)
    {
        try
        {
            string line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}";
            Console.WriteLine(line);
            File.AppendAllText(_logFile, line + Environment.NewLine);
        }
        catch { }
    }
}
