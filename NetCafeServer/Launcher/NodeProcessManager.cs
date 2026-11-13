using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace SoftechCockpit;

/// <summary>
/// Headless Node.js Lifecycle Manager for Softech Cashier Cockpit.
/// Manages silent background execution, health-check polling, and clean termination.
/// </summary>
public class NodeProcessManager
{
    private static readonly HttpClient DefaultHttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(2)
    };
    private readonly HttpClient _httpClient;
    public NodeProcessManager(HttpClient? httpClient = null) => _httpClient = httpClient ?? DefaultHttpClient;

    private Process? _spawnedProcess;
    private readonly SemaphoreSlim _startupGate = new(1, 1);
    internal Func<(string nodePath, string serverDir)> ResolvePaths = ResolveNodeAndServerPaths;
    internal TimeSpan StartupTimeout = TimeSpan.FromSeconds(90);
    internal Func<bool> PortIsBusy = () => Array.Exists(
        IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners(), endpoint => endpoint.Port == 5000);
    private readonly object _errorLock = new();
    private string _startupError = "";

    private void CaptureError(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        lock (_errorLock) {
            _startupError += line + Environment.NewLine;
            if (_startupError.Length > 12000) _startupError = _startupError[^12000..];
        }
    }

    private string StartupFailure(int exitCode, string serverDir)
    {
        string details;
        lock (_errorLock) details = _startupError.Trim();
        var message = $"Node.js server to'xtadi (Chiqish kodi: {exitCode}).";
        if (details.Length == 0) return message;
        var logPath = Path.Combine(serverDir, "logs", "node-startup-error.log");
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.WriteAllText(logPath, DateTimeOffset.Now.ToString("O") + Environment.NewLine + details, System.Text.Encoding.UTF8);
            message += Environment.NewLine + "Log: " + logPath;
        } catch { /* The original error must still be visible on a read-only install. */ }
        return message + Environment.NewLine + details;
    }

    private bool _isSpawnedByThisInstance;
    public string ServerDirectory => ResolvePaths().serverDir;

    public const string ServerUrl = "http://127.0.0.1:5000";
    public const string HealthCheckUrl = "http://127.0.0.1:5000/api/health";

    public event Action<string>? StatusChanged;

    public bool IsRunning => _spawnedProcess != null && !_spawnedProcess.HasExited;
    public bool HasUnexpectedExit => _isSpawnedByThisInstance && _spawnedProcess?.HasExited == true && _spawnedProcess.ExitCode != 0;

    public string GetExitDiagnostic()
    {
        if (_spawnedProcess?.HasExited != true) return "";
        _spawnedProcess.WaitForExit();
        return StartupFailure(_spawnedProcess.ExitCode, ServerDirectory);
    }

    /// <summary>
    /// Checks if a NetCafeServer is already responding on port 5000.
    /// </summary>
    public async Task<bool> IsServerHealthyAsync()
    {
        try
        {
            using var response = await _httpClient.GetAsync(HealthCheckUrl);
            if (!response.IsSuccessStatusCode) return false;
            using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = payload.RootElement;
            return root.TryGetProperty("app", out var app) && app.GetString() == "NetCafeServer" &&
                root.TryGetProperty("status", out var status) && status.GetString() == "ok";
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Ensures Node.js backend is running. If not already active on port 5000,
    /// locates runtime and launches it in headless background mode.
    /// </summary>
    public async Task<bool> EnsureServerRunningAsync(CancellationToken cancellationToken = default)
    {
        await _startupGate.WaitAsync(cancellationToken);
        try { return await StartOrWaitAsync(cancellationToken); }
        finally { _startupGate.Release(); }
    }

    private async Task<bool> StartOrWaitAsync(CancellationToken cancellationToken)
    {
        StatusChanged?.Invoke("Server holati tekshirilmoqda...");

        // 1. Agar server allaqachon ishlab turgan bo'lsa, qayta ishga tushirmaymiz
        if (await IsServerHealthyAsync())
        {
            StatusChanged?.Invoke("Server allaqachon faol (Port 5000).");
            return true;
        }

        // A port number alone does not identify our process. Never kill another application.
        if (IsRunning) return await WaitUntilReadyAsync(cancellationToken);
        if (PortIsBusy())
            throw new InvalidOperationException("5000-port band, ammo Softech serveri javob bermayapti. Portni ishlatayotgan dasturni tekshiring va qayta urining.");

        // 2. Node.js ijro faylini va server ildiz papkasini topish
        var (nodePath, serverDir) = ResolvePaths();

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
            RedirectStandardError = true,
            StandardErrorEncoding = System.Text.Encoding.UTF8
        };

        startInfo.Environment["SOFTECH_COCKPIT_PID"] = Environment.ProcessId.ToString();
        startInfo.Environment["SOFTECH_COCKPIT_EXE"] = Environment.ProcessPath!;

        try
        {
            // Dispose only an already exited process; retry never kills initialization.
            if (_spawnedProcess != null) {
                GetExitDiagnostic();
                _spawnedProcess.Dispose();
            }
            lock (_errorLock) _startupError = "";
            _spawnedProcess = new Process { StartInfo = startInfo };
            _spawnedProcess.ErrorDataReceived += (_, e) => CaptureError(e.Data);
            if (!_spawnedProcess.Start())
                throw new InvalidOperationException("Node.js jarayonini ishga tushirib bo'lmadi.");
            _spawnedProcess.BeginErrorReadLine();
            _isSpawnedByThisInstance = true;
            StatusChanged?.Invoke($"Node.js jarayoni ishga tushdi (PID: {_spawnedProcess.Id}). Bog'lanish kutilmoqda...");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Node.js jarayonini start qilishda xatolik: {ex.Message}", ex);
        }

        return await WaitUntilReadyAsync(cancellationToken);
    }

    private async Task<bool> WaitUntilReadyAsync(CancellationToken cancellationToken)
    {
        var elapsed = Stopwatch.StartNew();
        while (elapsed.Elapsed < StartupTimeout)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (_spawnedProcess == null) return false;
            if (_spawnedProcess.HasExited)
            {
                // Drain stderr even if Node exited before the first health check.
                _spawnedProcess.WaitForExit();
                throw new InvalidOperationException(GetExitDiagnostic());
            }

            if (await IsServerHealthyAsync())
            {
                StatusChanged?.Invoke("Server muvaffaqiyatli ishga tushdi va javob bermoqda.");
                return true;
            }

            await Task.Delay(200, cancellationToken);
        }

        // Verification/migration may still be running. A slow disk is not a crash.
        throw new TimeoutException("Server hali tayyor emas. Jarayon saqlandi; biroz kutib Qayta urinish tugmasini bosing.");
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
    public void StopNodeServer(bool forUpdate = false)
    {
        if (_spawnedProcess == null || !_isSpawnedByThisInstance) return;

        try
        {
            if (!_spawnedProcess.HasExited)
            {
                StatusChanged?.Invoke("Node.js serveri to'xtatilmoqda...");
                
                // .NET 8 Process.Kill(entireProcessTree: true)
                _spawnedProcess.Kill(entireProcessTree: !forUpdate);
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

}
