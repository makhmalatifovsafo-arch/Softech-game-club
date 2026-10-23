using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace SoftechCockpit;

/// <summary>
/// Headless Node.js Lifecycle Manager for Softech Cashier Cockpit.
/// Manages silent background execution, health-check polling, and clean termination.
/// </summary>
public class NodeProcessManager
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(2)
    };

    private Process? _spawnedProcess;
    private bool _isSpawnedByThisInstance;

    public const string ServerUrl = "http://127.0.0.1:5000";
    public const string HealthCheckUrl = "http://127.0.0.1:5000/api/health";

    public event Action<string>? StatusChanged;

    public bool IsRunning => _spawnedProcess != null && !_spawnedProcess.HasExited;

    /// <summary>
    /// Checks if a NetCafeServer is already responding on port 5000.
    /// </summary>
    public async Task<bool> IsServerHealthyAsync()
    {
        try
        {
            using var response = await HttpClient.GetAsync(HealthCheckUrl);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            // Fallback check to root or license status
            try
            {
                using var fallbackResp = await HttpClient.GetAsync(ServerUrl);
                return fallbackResp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Ensures Node.js backend is running. If not already active on port 5000,
    /// locates runtime and launches it in headless background mode.
    /// </summary>
    public async Task<bool> EnsureServerRunningAsync(CancellationToken cancellationToken = default)
    {
        StatusChanged?.Invoke("Server holati tekshirilmoqda...");

        // 1. Agar server allaqachon ishlab turgan bo'lsa, qayta ishga tushirmaymiz
        if (await IsServerHealthyAsync())
        {
            StatusChanged?.Invoke("Server allaqachon faol (Port 5000).");
            return true;
        }

        // Port 5000 da qotib qolgan zombi jarayon bo'lsa tozalash
        KillProcessOnPort(5000);

        // 2. Node.js ijro faylini va server ildiz papkasini topish
        var (nodePath, serverDir) = ResolveNodeAndServerPaths();

        if (string.IsNullOrEmpty(nodePath) || !File.Exists(nodePath))
        {
            throw new FileNotFoundException($"Node.js ijro fayli (node.exe) topilmadi. Qidirilgan yo'l: '{nodePath}'");
        }

        var entryScriptPath = Path.Combine(serverDir, "src", "server.js");
        if (!File.Exists(entryScriptPath))
        {
            throw new FileNotFoundException($"Server kirish skripti (src/server.js) topilmadi. Qidirilgan papka: '{serverDir}'");
        }

        StatusChanged?.Invoke("Node.js server fon rejimida ishga tushirilmoqda...");

        // 3. Strict Headless Process parametrlari (Qora CMD / Konsol umuman ochilmaydi)
        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "src/server.js",
            WorkingDirectory = serverDir,
            CreateNoWindow = true,
            UseShellExecute = false,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = false,
            RedirectStandardError = false
        };

        try
        {
            _spawnedProcess = Process.Start(startInfo);
            if (_spawnedProcess == null || _spawnedProcess.HasExited)
            {
                throw new InvalidOperationException("Node.js jarayonini ishga tushirib bo'lmadi.");
            }

            _isSpawnedByThisInstance = true;
            StatusChanged?.Invoke($"Node.js jarayoni ishga tushdi (PID: {_spawnedProcess.Id}). Bog'lanish kutilmoqda...");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Node.js jarayonini start qilishda xatolik: {ex.Message}", ex);
        }

        // 4. Asinxron Health-Check so'rovlari (Har 200ms, maksimal 15 soniya)
        var startTime = DateTime.UtcNow;
        var timeout = TimeSpan.FromSeconds(15);

        while (DateTime.UtcNow - startTime < timeout)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                StopNodeServer();
                return false;
            }

            if (_spawnedProcess.HasExited)
            {
                throw new InvalidOperationException($"Node.js server kutilmaganda to'xtadi (Chiqish kodi: {_spawnedProcess.ExitCode}).");
            }

            if (await IsServerHealthyAsync())
            {
                StatusChanged?.Invoke("Server muvaffaqiyatli ishga tushdi va javob bermoqda.");
                return true;
            }

            await Task.Delay(200, cancellationToken);
        }

        // Timeout bo'lganda to'xtatish
        StopNodeServer();
        throw new TimeoutException("Node.js server 15 soniya ichida javob bermadi (Health-Check Timeout).");
    }

    /// <summary>
    /// Bundled runtime yoki tizim Node yo'lini va NetCafeServer papkasini aniqlash.
    /// </summary>
    private static (string nodePath, string serverDir) ResolveNodeAndServerPaths()
    {
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;

        // Mumkin bo'lgan server papkalari
        string[] candidateServerDirs =
        [
            baseDir,
            Path.GetFullPath(Path.Combine(baseDir, "..")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..")),
            Path.GetFullPath(Path.Combine(baseDir, "NetCafeServer")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "NetCafeServer"))
        ];

        string resolvedServerDir = "";
        foreach (var dir in candidateServerDirs)
        {
            if (File.Exists(Path.Combine(dir, "src", "server.js")))
            {
                resolvedServerDir = dir;
                break;
            }
        }

        if (string.IsNullOrEmpty(resolvedServerDir))
        {
            resolvedServerDir = baseDir;
        }

        // 1. Birinchi navbatda: Bundled runtime (NetCafeServer/runtime/node.exe)
        string[] candidateNodePaths =
        [
            Path.Combine(resolvedServerDir, "runtime", "node.exe"),
            Path.Combine(baseDir, "runtime", "node.exe"),
            Path.Combine(baseDir, "..", "runtime", "node.exe"),
            Path.Combine(baseDir, "node.exe")
        ];

        foreach (var path in candidateNodePaths)
        {
            if (File.Exists(path))
            {
                return (Path.GetFullPath(path), resolvedServerDir);
            }
        }

        // 2. Ikkinchi navbatda: Tizim PATH dagi node.exe
        var systemNode = FindInSystemPath("node.exe");
        if (!string.IsNullOrEmpty(systemNode))
        {
            return (systemNode, resolvedServerDir);
        }

        // Fallback
        return (Path.Combine(resolvedServerDir, "runtime", "node.exe"), resolvedServerDir);
    }

    private static string? FindInSystemPath(string fileName)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return null;

        foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var full = Path.Combine(dir.Trim(), fileName);
                if (File.Exists(full)) return full;
            }
            catch { }
        }

        return null;
    }

    /// <summary>
    /// Dastur yopilganda fondagi Node.js va uning barcha child jarayonlarini toza o'chirish.
    /// </summary>
    public void StopNodeServer()
    {
        if (_spawnedProcess == null || !_isSpawnedByThisInstance) return;

        try
        {
            if (!_spawnedProcess.HasExited)
            {
                StatusChanged?.Invoke("Node.js serveri to'xtatilmoqda...");
                
                // .NET 8 Process.Kill(entireProcessTree: true)
                _spawnedProcess.Kill(entireProcessTree: true);
                _spawnedProcess.WaitForExit(3000);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[NodeProcessManager] Jarayonni o'chirishda ogohlantirish: {ex.Message}");
        }
        finally
        {
            try { _spawnedProcess.Dispose(); } catch { }
            _spawnedProcess = null;
            _isSpawnedByThisInstance = false;
        }
    }

    /// <summary>
    /// Port band bo'lsa (masalan qotib qolgan zombi Node instansiyasi), uning jarayonini to'xtatadi.
    /// </summary>
    public static void KillProcessOnPort(int port)
    {
        try
        {
            var p = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c netstat -ano | findstr :{port}",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true
                }
            };
            p.Start();
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(1000);

            foreach (var line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (line.Contains("LISTENING", StringComparison.OrdinalIgnoreCase))
                {
                    var parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 0 && int.TryParse(parts[^1], out int pid) && pid > 0)
                    {
                        try
                        {
                            var procToKill = Process.GetProcessById(pid);
                            procToKill.Kill(entireProcessTree: true);
                            procToKill.WaitForExit(1000);
                        }
                        catch { }
                    }
                }
            }
        }
        catch { }
    }
}
