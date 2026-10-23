using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using NetCafeClient;
using NetCafeClient.Services.Security;

namespace NetCafeClient.Services;

/// <summary>
/// AutoUpdateService — Enterprise-grade Zero-Downtime GitHub Releases Over-The-Air (OTA) Auto-Updater.
/// O'yin klubi qoidalari:
/// 1. Faol seans vaqtida o'yinchi aslo to'xtatilmaydi.
/// 2. Yangilanish orqa fonda yuklanib, staging katalogida tayyor turadi.
/// 3. Seans tugagan zahoti (AVAILABLE/LOCKED holatida) SoftechUpdater ga topshiriladi.
/// 4. GitHub direct static endpointlari: User-Agent: Softech-Updater sarlavhasi bilan so'raladi.
/// </summary>
public class AutoUpdateService
{
    private static readonly Lazy<AutoUpdateService> _instance = new(() => new AutoUpdateService());
    public static AutoUpdateService Instance => _instance.Value;

    // ---- Manifest Modeli (GitHub Releases version.json) ----
    public class UpdateFileItem
    {
        [JsonPropertyName("downloadUrl")]
        public string? DownloadUrl { get; set; }

        [JsonPropertyName("url")]
        public string? Url { get; set; }

        [JsonIgnore]
        public string EffectiveUrl => !string.IsNullOrWhiteSpace(DownloadUrl) ? DownloadUrl : (Url ?? string.Empty);

        [JsonPropertyName("sha256")]
        public string? Sha256 { get; set; }
    }

    public class UpdateManifest
    {
        [JsonPropertyName("version")]
        public string Version { get; set; } = "1.0.0";

        [JsonPropertyName("releaseDate")]
        public string? ReleaseDate { get; set; }

        [JsonPropertyName("client")]
        public UpdateFileItem? Client { get; set; }

        [JsonPropertyName("server")]
        public UpdateFileItem? Server { get; set; }

        [JsonPropertyName("changelog")]
        public string? Changelog { get; set; }
    }

    // ---- State & Fields ----
    private readonly HttpClient _httpClient;
    private PeriodicTimer? _checkTimer;
    private CancellationTokenSource? _cts;
    private Func<bool>? _isSessionActiveFunc;

    private readonly string _stagingDir;
    private readonly string _extractedDir;
    private readonly string _currentVersion;

    public string CurrentVersion => _currentVersion;
    public string? StagedVersion { get; private set; }
    public bool IsUpdateStaged { get; private set; }
    public bool IsChecking { get; private set; }
    public bool IsDownloading { get; private set; }

    public string? ManifestUrl { get; set; }

    // ---- Events ----
    public event Action<string, string>? OnUpdateAvailable; // (version, changelog)
    public event Action<string>? OnUpdateStaged;           // (version)
    public event Action<string>? OnUpdatePendingSession;   // (version)
    public event Action<int>? OnDownloadProgress;          // (percentage)
    public event Action<string>? OnUpdateError;             // (errorMessage)

    private AutoUpdateService()
    {
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        // GitHub API va Releases 403 xatosini oldini olish uchun User-Agent sarlavhasi
        _httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Softech-Updater", "1.0"));

        _stagingDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SoftechClient",
            "staging"
        );
        _extractedDir = Path.Combine(_stagingDir, "extracted");

        Version? v = Assembly.GetExecutingAssembly().GetName().Version;
        _currentVersion = v != null ? $"{v.Major}.{v.Minor}.{v.Build}" : "1.0.0";
    }

    /// <summary>
    /// Xizmatni initsializatsiya qilish
    /// </summary>
    public void Initialize(string? manifestUrl, Func<bool> isSessionActiveFunc)
    {
        _isSessionActiveFunc = isSessionActiveFunc;
        ManifestUrl = ResolveManifestUrl(manifestUrl);

        Directory.CreateDirectory(_stagingDir);
    }

    /// <summary>
    /// Davriy tekshirishni boshlash (Standart: har 15 daqiqada)
    /// </summary>
    public void StartPeriodicChecks(TimeSpan? interval = null)
    {
        TimeSpan checkInterval = interval ?? TimeSpan.FromMinutes(15);
        _cts?.Cancel();
        _cts = new CancellationTokenSource();

        _ = Task.Run(async () =>
        {
            // Dastur ishga tushgach 5 soniya kutib, birinchi tekshiruvni o'tkazamiz
            await Task.Delay(TimeSpan.FromSeconds(5), _cts.Token);
            await CheckForUpdatesAsync();

            _checkTimer = new PeriodicTimer(checkInterval);
            try
            {
                while (await _checkTimer.WaitForNextTickAsync(_cts.Token))
                {
                    await CheckForUpdatesAsync();
                }
            }
            catch (OperationCanceledException) { }
        });
    }

    /// <summary>
    /// GitHub Releases manifest orqali yangilanish mavjudligini tekshirish
    /// </summary>
    public async Task<bool> CheckForUpdatesAsync()
    {
        if (IsChecking || IsDownloading || string.IsNullOrWhiteSpace(ManifestUrl))
            return false;

        IsChecking = true;
        try
        {
            Debug.WriteLine($"🌐 [AutoUpdate] GitHub Manifest tekshirilmoqda: {ManifestUrl}");
            using var request = new HttpRequestMessage(HttpMethod.Get, ManifestUrl);
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);

            if (!response.IsSuccessStatusCode)
            {
                Debug.WriteLine($"⚠️ [AutoUpdate] Manifestni yuklab bo'lmadi: HTTP {response.StatusCode}");
                return false;
            }

            string json = await response.Content.ReadAsStringAsync();
            var manifest = JsonSerializer.Deserialize<UpdateManifest>(json);

            if (manifest?.Client == null || string.IsNullOrWhiteSpace(manifest.Client.EffectiveUrl))
            {
                Debug.WriteLine("[AutoUpdate] Manifestda client yangilanish fayli (downloadUrl) topilmadi.");
                return false;
            }

            if (IsNewerVersion(manifest.Version, _currentVersion))
            {
                Debug.WriteLine($"🚀 [AutoUpdate] Yangi versiya aniqlandi: v{manifest.Version} (Joriy: v{_currentVersion})");
                OnUpdateAvailable?.Invoke(manifest.Version, manifest.Changelog ?? "VIP narxlar to'g'rilandi va xavfsizlik kuchaytirildi.");

                // Agar bu versiya allaqachon staging papkasida mavjud bo'lsa
                if (IsUpdateStaged && StagedVersion == manifest.Version)
                {
                    EvaluateStateAndHandover();
                    return true;
                }

                // Orqa fonda yuklab, staging ga tayyorlaymiz
                return await DownloadAndStageUpdateAsync(manifest);
            }
            else
            {
                Debug.WriteLine($"✓ [AutoUpdate] NetCafeClient eng so'nggi versiyada (v{_currentVersion}).");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"❌ [AutoUpdate] Tekshirishda xatolik: {ex.Message}");
            OnUpdateError?.Invoke(ex.Message);
        }
        finally
        {
            IsChecking = false;
        }

        return false;
    }

    /// <summary>
    /// SoftechClient.zip arxivini fonda yuklab olish, SHA256 tekshirish va staging ga ochish
    /// </summary>
    private async Task<bool> DownloadAndStageUpdateAsync(UpdateManifest manifest)
    {
        if (manifest.Client == null || string.IsNullOrWhiteSpace(manifest.Client.EffectiveUrl))
            return false;

        IsDownloading = true;
        string downloadUrl = manifest.Client.EffectiveUrl;
        string zipPath = Path.Combine(_stagingDir, $"client_v{manifest.Version}.zip");

        try
        {
            Debug.WriteLine($"⬇️ [AutoUpdate] GitHub Release yuklanmoqda: {downloadUrl}");

            using (var response = await _httpClient.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();

                long? totalBytes = response.Content.Headers.ContentLength;
                await using var stream = await response.Content.ReadAsStreamAsync();
                await using var fileStream = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None);

                var buffer = new byte[81920];
                long totalRead = 0;
                int bytesRead;

                while ((bytesRead = await stream.ReadAsync(buffer)) > 0)
                {
                    await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead));
                    totalRead += bytesRead;

                    if (totalBytes.HasValue && totalBytes.Value > 0)
                    {
                        int progress = (int)((totalRead * 100) / totalBytes.Value);
                        OnDownloadProgress?.Invoke(progress);
                    }
                }
            }

            Debug.WriteLine($"✅ [AutoUpdate] Arxiv yuklandi ({new FileInfo(zipPath).Length / 1024} KB).");

            // SHA256 Tekshiruvi (agar manifestda taqdim etilgan bo'lsa)
            if (!string.IsNullOrWhiteSpace(manifest.Client.Sha256))
            {
                string computedHash = ComputeSha256(zipPath);
                if (!string.Equals(computedHash, manifest.Client.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    Debug.WriteLine($"❌ [AutoUpdate] SHA256 mos kelmadi! Kutilgan: {manifest.Client.Sha256}, Olingan: {computedHash}");
                    File.Delete(zipPath);
                    OnUpdateError?.Invoke("Yuklangan fayl yaxlitligi tekshiruvdan o'tmadi (SHA256 mismatch).");
                    return false;
                }
                Debug.WriteLine("🔒 [AutoUpdate] SHA256 yaxlitligi tasdiqlandi.");
            }

            // Staging extracted papkasiga ochish
            if (Directory.Exists(_extractedDir))
            {
                Directory.Delete(_extractedDir, recursive: true);
            }
            Directory.CreateDirectory(_extractedDir);

            ZipFile.ExtractToDirectory(zipPath, _extractedDir, overwriteFiles: true);
            File.Delete(zipPath); // ZIP faylni o'chiramiz

            // SoftechUpdater.exe ni ham staging katalogiga tayyorlab qo'yamiz
            StageCompanionUpdater();

            IsUpdateStaged = true;
            StagedVersion = manifest.Version;

            Debug.WriteLine($"📦 [AutoUpdate] Versiya v{manifest.Version} staging katalogiga muvaffaqiyatli tayyorlandi.");
            OnUpdateStaged?.Invoke(manifest.Version);

            // Holatni tekshirish: Seans yo'q bo'lsa darhol, aks holda seans tugashini kutish
            EvaluateStateAndHandover();
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"❌ [AutoUpdate] Yuklash yoki ochishda xatolik: {ex.Message}");
            OnUpdateError?.Invoke(ex.Message);
            return false;
        }
        finally
        {
            IsDownloading = false;
        }
    }

    /// <summary>
    /// Seans tugaganida App.xaml.cs yoki WebSocket xabaridan chaqiriladi
    /// </summary>
    public void OnSessionEnded()
    {
        if (IsUpdateStaged)
        {
            Debug.WriteLine("🔔 [AutoUpdate] Seans tugadi! Staged yangilanish darhol qo'llanilmoqda...");
            ApplyStagedUpdate();
        }
    }

    /// <summary>
    /// Workstation holatini tekshirish va Handover rejimini tanlash
    /// </summary>
    private void EvaluateStateAndHandover()
    {
        bool sessionActive = _isSessionActiveFunc?.Invoke() ?? false;

        if (sessionActive)
        {
            Debug.WriteLine("🎮 [AutoUpdate] Workstation hozir BAND (faol seans ketmoqda). Yangilanish seans tugaguncha kechiktirildi.");
            if (StagedVersion != null)
            {
                OnUpdatePendingSession?.Invoke(StagedVersion);
            }
        }
        else
        {
            Debug.WriteLine("🟢 [AutoUpdate] Workstation BO'SH / QULFLANGAN. Yangilanish darhol o'rnatiladi!");
            ApplyStagedUpdate();
        }
    }

    /// <summary>
    /// SoftechUpdater.exe orqali xavfsiz fayllarni almashtirish va dasturni qayta yoqish
    /// </summary>
    public void ApplyStagedUpdate()
    {
        if (!IsUpdateStaged || !Directory.Exists(_extractedDir))
        {
            Debug.WriteLine("⚠️ [AutoUpdate] Yangilanish staging da topilmadi.");
            return;
        }

        try
        {
            string appBaseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            string updaterExePath = Path.Combine(_stagingDir, "SoftechUpdater.exe");

            if (!File.Exists(updaterExePath))
            {
                updaterExePath = Path.Combine(appBaseDir, "SoftechUpdater.exe");
            }

            if (!File.Exists(updaterExePath))
            {
                Debug.WriteLine("❌ [AutoUpdate] SoftechUpdater.exe topilmadi!");
                OnUpdateError?.Invoke("SoftechUpdater.exe topilmadi.");
                return;
            }

            int currentPid = Process.GetCurrentProcess().Id;

            // 1. Watchdog uchun ruxsatli chiqish markerini yozamiz
            WatchdogService.RequestGracefulShutdown();

            // 2. Klaviatura va Windows taskbarni tiklaymiz
            try
            {
                LockWindow.ShowWindowsTaskbar();
                KeyboardHook.Stop();
                TaskManagerBlocker.DisableRestrictions();
                UsbGuardService.Instance.RestoreRegistryPolicies();
            }
            catch { }

            // 3. SoftechUpdater ni detached jarayon sifatida ishga tushiramiz
            var psi = new ProcessStartInfo
            {
                FileName = updaterExePath,
                Arguments = $"--target \"{appBaseDir}\" --source \"{_extractedDir}\" --pid {currentPid} --restart NetCafeClient.exe --timeout 15",
                WorkingDirectory = _stagingDir,
                UseShellExecute = true,
                CreateNoWindow = false
            };

            Debug.WriteLine($"🚀 [AutoUpdate] SoftechUpdater ishga tushirilmoqda: {psi.FileName} {psi.Arguments}");
            Process.Start(psi);

            // 4. NetCafeClient ni toza to'xtatamiz
            App.Current.Dispatcher.Invoke(() =>
            {
                App.Current.Shutdown(0);
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"❌ [AutoUpdate] ApplyStagedUpdate xatosi: {ex.Message}");
            OnUpdateError?.Invoke(ex.Message);
        }
    }

    private void StageCompanionUpdater()
    {
        try
        {
            string appBaseDir = AppDomain.CurrentDomain.BaseDirectory;
            string localUpdater = Path.Combine(appBaseDir, "SoftechUpdater.exe");
            string stagingUpdater = Path.Combine(_stagingDir, "SoftechUpdater.exe");

            if (File.Exists(localUpdater))
            {
                File.Copy(localUpdater, stagingUpdater, overwrite: true);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [AutoUpdate] StageCompanionUpdater: {ex.Message}");
        }
    }

    private static string ComputeSha256(string filePath)
    {
        using var sha256 = SHA256.Create();
        using var stream = File.OpenRead(filePath);
        byte[] hash = sha256.ComputeHash(stream);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    private static bool IsNewerVersion(string remoteVer, string localVer)
    {
        try
        {
            var r = ParseVersion(remoteVer);
            var l = ParseVersion(localVer);
            return r > l;
        }
        catch
        {
            return false;
        }
    }

    private static Version ParseVersion(string vStr)
    {
        string clean = vStr.Trim().TrimStart('v', 'V');
        string[] parts = clean.Split('.');
        int major = parts.Length > 0 && int.TryParse(parts[0], out int mj) ? mj : 1;
        int minor = parts.Length > 1 && int.TryParse(parts[1], out int mn) ? mn : 0;
        int build = parts.Length > 2 && int.TryParse(parts[2], out int bd) ? bd : 0;
        return new Version(major, minor, build);
    }

    private static string ResolveManifestUrl(string? rawUrl)
    {
        if (!string.IsNullOrWhiteSpace(rawUrl))
            return rawUrl.Trim();

        // config.json dan tekshiramiz
        try
        {
            string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json");
            if (File.Exists(configPath))
            {
                string json = File.ReadAllText(configPath);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                // 1. To'g'ridan-to'g'ri manifest URL ko'rsatilgan bo'lsa
                if (root.TryGetProperty("updateManifestUrl", out var updateProp) && !string.IsNullOrWhiteSpace(updateProp.GetString()))
                {
                    return updateProp.GetString()!.Trim();
                }

                // 2. GitHub repo ko'rsatilgan bo'lsa: githubOwner va githubRepo
                string githubOwner = root.TryGetProperty("githubOwner", out var oProp) ? oProp.GetString()?.Trim() ?? "" : "";
                string githubRepo = root.TryGetProperty("githubRepo", out var rProp) ? rProp.GetString()?.Trim() ?? "" : "";
                if (!string.IsNullOrEmpty(githubOwner) && !string.IsNullOrEmpty(githubRepo))
                {
                    return $"https://github.com/{githubOwner}/{githubRepo}/releases/latest/download/version.json";
                }

                // 3. Mahalliy serverdan olish fallback
                if (root.TryGetProperty("serverUrl", out var serverProp))
                {
                    string wsUrl = serverProp.GetString() ?? "";
                    if (!string.IsNullOrWhiteSpace(wsUrl))
                    {
                        var uri = new Uri(wsUrl.Replace("ws://", "http://").Replace("wss://", "https://"));
                        return $"{uri.Scheme}://{uri.Authority}/api/updates/version.json";
                    }
                }
            }
        }
        catch { }

        // Standart GitHub reliz URL fallback
        return "https://github.com/makhmalatifovsafo-arch/Softech-game-club/releases/latest/download/version.json";
    }
}
