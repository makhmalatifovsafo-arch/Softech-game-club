using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;
using NetCafeClient.Models;

namespace NetCafeClient.Services.Games;

/// <summary>
/// GameScannerService — Lokal o'rnatilgan o'yinlarni avtomatik aniqlovchi xizmat.
/// Platformalar: Steam (libraryfolders.vdf & appmanifest_*.acf), Epic Games (.item manifestlar),
/// Riot Games (Valorant & LoL) hamda diskdagi Custom/Portable o'yinlar papkalari.
/// </summary>
public class GameScannerService
{
    private static readonly Lazy<GameScannerService> _instance = new(() => new GameScannerService());
    public static GameScannerService Instance => _instance.Value;

    // Aniqlanmasligi kerak bo'lgan yordamchi/o'chiruvchi fayllar ro'yxati
    private static readonly HashSet<string> ExcludedExes = new(StringComparer.OrdinalIgnoreCase)
    {
        "unins000.exe", "uninstall.exe", "uninstaller.exe", "unitycrashhandler64.exe",
        "unitycrashhandler32.exe", "crashreport.exe", "crashreporter.exe", "dxwebsetup.exe",
        "vcredist_x64.exe", "vcredist_x86.exe", "setup.exe", "patcher.exe", "update.exe",
        "updater.exe", "redist.exe", "7z.exe", "dotnetfx.exe", "cleanup.exe", "config.exe",
        "easyanticheat_setup.exe", "battleye_setup.exe", "launcher_prerequisites.exe"
    };

    public GameScannerService() { }

    /// <summary>
    /// Barcha qo'llab-quvvatlanadigan platformalar bo'yicha o'yinlarni to'liq skaner qilish
    /// </summary>
    public async Task<List<GameItem>> ScanAllGamesAsync(IEnumerable<string>? customFolders = null)
    {
        return await Task.Run(() =>
        {
            var foundGames = new Dictionary<string, GameItem>(StringComparer.OrdinalIgnoreCase);

            // 1. Steam O'yinlarini skaner qilish
            try
            {
                var steamGames = ScanSteamGames();
                foreach (var g in steamGames)
                {
                    foundGames[g.Title] = g;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Steam skanerlashda xato: {ex.Message}");
            }

            // 2. Epic Games O'yinlarini skaner qilish
            try
            {
                var epicGames = ScanEpicGames();
                foreach (var g in epicGames)
                {
                    if (!foundGames.ContainsKey(g.Title))
                    {
                        foundGames[g.Title] = g;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Epic Games skanerlashda xato: {ex.Message}");
            }

            // 3. Riot Games (Valorant, League of Legends)
            try
            {
                var riotGames = ScanRiotGames();
                foreach (var g in riotGames)
                {
                    if (!foundGames.ContainsKey(g.Title))
                    {
                        foundGames[g.Title] = g;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Riot Games skanerlashda xato: {ex.Message}");
            }

            // 4. Custom / Portable o'yinlar (D:\Games, C:\Games va ko'rsatilgan yo'llar)
            try
            {
                var customGames = ScanCustomFolders(customFolders);
                foreach (var g in customGames)
                {
                    if (!foundGames.ContainsKey(g.Title))
                    {
                        foundGames[g.Title] = g;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Custom papkalarni skanerlashda xato: {ex.Message}");
            }

            return foundGames.Values.OrderBy(g => g.Title).ToList();
        });
    }

    // =========================================================================
    // 1. STEAM SCANNER (libraryfolders.vdf & appmanifest_*.acf)
    // =========================================================================
    public List<GameItem> ScanSteamGames()
    {
        var games = new List<GameItem>();
        string? steamInstallPath = GetSteamInstallPath();

        if (string.IsNullOrEmpty(steamInstallPath) || !Directory.Exists(steamInstallPath))
        {
            return games;
        }

        // Barcha Steam kutubxona papkalarini aniqlash (libraryfolders.vdf)
        var libraryFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { steamInstallPath };
        string vdfPath = Path.Combine(steamInstallPath, "steamapps", "libraryfolders.vdf");

        if (File.Exists(vdfPath))
        {
            try
            {
                string vdfText = File.ReadAllText(vdfPath);
                // "path" "D:\\SteamLibrary" kabi qatorlarni regex orqali ushlash
                var matches = Regex.Matches(vdfText, @"""path""\s+""([^""]+)""", RegexOptions.IgnoreCase);
                foreach (Match m in matches)
                {
                    string path = m.Groups[1].Value.Replace(@"\\", @"\");
                    if (Directory.Exists(path))
                    {
                        libraryFolders.Add(path);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] libraryfolders.vdf o'qishda xato: {ex.Message}");
            }
        }

        // Har bir kutubxona ichidagi appmanifest_*.acf fayllarini o'qish
        foreach (var lib in libraryFolders)
        {
            string steamAppsDir = Path.Combine(lib, "steamapps");
            if (!Directory.Exists(steamAppsDir)) continue;

            string[] manifestFiles;
            try
            {
                manifestFiles = Directory.GetFiles(steamAppsDir, "appmanifest_*.acf");
            }
            catch { continue; }

            foreach (var manifestPath in manifestFiles)
            {
                try
                {
                    string acfContent = File.ReadAllText(manifestPath);

                    string appId = ExtractAcfValue(acfContent, "appid");
                    string name = ExtractAcfValue(acfContent, "name");
                    string installdir = ExtractAcfValue(acfContent, "installdir");

                    // 228980 (Steamworks Common Redistributables) kabi drayver/kutubxonalarni chetlab o'tish
                    if (string.IsNullOrEmpty(appId) || string.IsNullOrEmpty(name) || appId == "228980")
                        continue;

                    string gameDir = Path.Combine(steamAppsDir, "common", installdir);
                    string? mainExe = FindMainExecutable(gameDir);

                    var game = new GameItem
                    {
                        Title = name,
                        Platform = "Steam",
                        AppId = appId,
                        ExecutablePath = $"steam://rungameid/{appId}",
                        InstallDirectory = gameDir,
                        IconPath = mainExe ?? string.Empty,
                        ProcessName = mainExe != null ? Path.GetFileNameWithoutExtension(mainExe) : GetDefaultSteamProcess(appId),
                        Category = DetectCategory(name),
                        IconGlyph = "🎮",
                        Badge = (appId == "730" || appId == "570") ? "TOP 1" : "STEAM",
                        BadgeColor = (appId == "730" || appId == "570") ? "#F59E0B" : "#1E293B"
                    };

                    games.Add(game);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[GameScanner] ACF parse xatosi ({manifestPath}): {ex.Message}");
                }
            }
        }

        return games;
    }

    private static string? GetSteamInstallPath()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            if (key?.GetValue("SteamPath") is string steamPath && Directory.Exists(steamPath))
            {
                return steamPath.Replace('/', '\\');
            }
        }
        catch { }

        try
        {
            using var key64 = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam");
            if (key64?.GetValue("InstallPath") is string installPath && Directory.Exists(installPath))
            {
                return installPath;
            }
        }
        catch { }

        string fallback = @"C:\Program Files (x86)\Steam";
        return Directory.Exists(fallback) ? fallback : null;
    }

    private static string ExtractAcfValue(string text, string key)
    {
        var match = Regex.Match(text, $@"""{key}""\s+""([^""]+)""", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : string.Empty;
    }

    private static string GetDefaultSteamProcess(string appId) => appId switch
    {
        "730" => "cs2",
        "570" => "dota2",
        "578080" => "TslGame",
        "1172470" => "r5apex",
        "271590" => "GTA5",
        "1091500" => "Cyberpunk2077",
        _ => string.Empty
    };

    // =========================================================================
    // 2. EPIC GAMES SCANNER (ProgramData Manifests)
    // =========================================================================
    public List<GameItem> ScanEpicGames()
    {
        var games = new List<GameItem>();
        string epicManifestsDir = @"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests";

        if (!Directory.Exists(epicManifestsDir))
            return games;

        string[] itemFiles;
        try
        {
            itemFiles = Directory.GetFiles(epicManifestsDir, "*.item");
        }
        catch { return games; }

        foreach (var itemPath in itemFiles)
        {
            try
            {
                string jsonText = File.ReadAllText(itemPath);
                using var doc = JsonDocument.Parse(jsonText);
                var root = doc.RootElement;

                string displayName = root.TryGetProperty("DisplayName", out var dp) ? dp.GetString() ?? "" : "";
                string installLocation = root.TryGetProperty("InstallLocation", out var il) ? il.GetString() ?? "" : "";
                string launchExecutable = root.TryGetProperty("LaunchExecutable", out var le) ? le.GetString() ?? "" : "";
                string appName = root.TryGetProperty("AppName", out var an) ? an.GetString() ?? "" : "";

                if (string.IsNullOrWhiteSpace(displayName) || !Directory.Exists(installLocation))
                    continue;

                // Unreal Engine yoki boshqa launcher komponentlarini o'tkazib yuborish
                if (displayName.Contains("Unreal Engine", StringComparison.OrdinalIgnoreCase))
                    continue;

                string fullExe = Path.Combine(installLocation, launchExecutable);
                if (!File.Exists(fullExe))
                {
                    fullExe = FindMainExecutable(installLocation) ?? fullExe;
                }

                var game = new GameItem
                {
                    Title = displayName,
                    Platform = "Epic",
                    AppId = appName,
                    ExecutablePath = fullExe,
                    InstallDirectory = installLocation,
                    IconPath = fullExe,
                    ProcessName = Path.GetFileNameWithoutExtension(launchExecutable),
                    Category = DetectCategory(displayName),
                    Badge = "EPIC",
                    BadgeColor = "#2563EB",
                    IconGlyph = "🎮"
                };

                games.Add(game);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Epic manifest xatosi ({itemPath}): {ex.Message}");
            }
        }

        return games;
    }

    // =========================================================================
    // 3. RIOT GAMES SCANNER (Valorant, League of Legends)
    // =========================================================================
    public List<GameItem> ScanRiotGames()
    {
        var games = new List<GameItem>();

        // Valorant qidiruvi
        string[] valorantPaths =
        {
            @"C:\Riot Games\VALORANT\live\VALORANT.exe",
            @"D:\Riot Games\VALORANT\live\VALORANT.exe",
            @"E:\Riot Games\VALORANT\live\VALORANT.exe"
        };

        foreach (var p in valorantPaths)
        {
            if (File.Exists(p))
            {
                games.Add(new GameItem
                {
                    Title = "Valorant",
                    Platform = "Riot",
                    AppId = "valorant",
                    ExecutablePath = p,
                    InstallDirectory = Path.GetDirectoryName(p) ?? "",
                    IconPath = p,
                    ProcessName = "VALORANT-Win64-Shipping",
                    Category = "Otishma",
                    Badge = "HOT",
                    BadgeColor = "#F43F5E",
                    IconGlyph = "⚡",
                    GradientStart = "#3B0764",
                    GradientEnd = "#1E1B4B",
                    AccentColor = "#F43F5E"
                });
                break;
            }
        }

        // League of Legends qidiruvi
        string[] lolPaths =
        {
            @"C:\Riot Games\League of Legends\LeagueClient.exe",
            @"D:\Riot Games\League of Legends\LeagueClient.exe",
            @"E:\Riot Games\League of Legends\LeagueClient.exe"
        };

        foreach (var p in lolPaths)
        {
            if (File.Exists(p))
            {
                games.Add(new GameItem
                {
                    Title = "League of Legends",
                    Platform = "Riot",
                    AppId = "league_of_legends",
                    ExecutablePath = p,
                    InstallDirectory = Path.GetDirectoryName(p) ?? "",
                    IconPath = p,
                    ProcessName = "LeagueClient",
                    Category = "MOBA / Strategiya",
                    Badge = "HOT",
                    BadgeColor = "#2563EB",
                    IconGlyph = "🧙",
                    GradientStart = "#172554",
                    GradientEnd = "#0B0F19",
                    AccentColor = "#60A5FA"
                });
                break;
            }
        }

        return games;
    }

    // =========================================================================
    // 4. CUSTOM / PORTABLE / PIRATED GAMES SCANNER
    // =========================================================================
    public List<GameItem> ScanCustomFolders(IEnumerable<string>? customFolders = null)
    {
        var games = new List<GameItem>();
        var searchRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (customFolders != null)
        {
            foreach (var f in customFolders)
            {
                if (Directory.Exists(f)) searchRoots.Add(f);
            }
        }

        // Barcha qattiq disklardagi (C:\, D:\, E:\) Games papkalarini avtomatik qo'shish
        try
        {
            foreach (var drive in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady))
            {
                string defaultGames = Path.Combine(drive.RootDirectory.FullName, "Games");
                if (Directory.Exists(defaultGames)) searchRoots.Add(defaultGames);

                string defaultGamesUz = Path.Combine(drive.RootDirectory.FullName, "O'yinlar");
                if (Directory.Exists(defaultGamesUz)) searchRoots.Add(defaultGamesUz);
            }
        }
        catch { }

        foreach (var root in searchRoots)
        {
            try
            {
                var subDirs = Directory.GetDirectories(root);
                foreach (var gameFolder in subDirs)
                {
                    string folderName = Path.GetFileName(gameFolder);
                    string? mainExe = FindMainExecutable(gameFolder);

                    if (mainExe != null && File.Exists(mainExe))
                    {
                        string cleanTitle = CleanGameTitle(folderName, mainExe);

                        var game = new GameItem
                        {
                            Title = cleanTitle,
                            Platform = "Custom",
                            AppId = Path.GetFileNameWithoutExtension(mainExe).ToLowerInvariant(),
                            ExecutablePath = mainExe,
                            InstallDirectory = gameFolder,
                            IconPath = mainExe,
                            ProcessName = Path.GetFileNameWithoutExtension(mainExe),
                            Category = DetectCategory(cleanTitle),
                            Badge = "LOKAL",
                            BadgeColor = "#059669",
                            IconGlyph = "🎮"
                        };

                        games.Add(game);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[GameScanner] Root papka skanerlashda xato ({root}): {ex.Message}");
            }
        }

        return games;
    }

    // =========================================================================
    // UTILITY: EXECUTABLE & METADATA DETECTION
    // =========================================================================
    private static string? FindMainExecutable(string folder)
    {
        if (!Directory.Exists(folder)) return null;

        try
        {
            // Ichki 2 ta qatlamgacha bo'lgan barcha .exe fayllarni qidirish
            var exeFiles = Directory.GetFiles(folder, "*.exe", SearchOption.TopDirectoryOnly)
                .Concat(Directory.EnumerateDirectories(folder)
                    .Take(5)
                    .SelectMany(sub =>
                    {
                        try { return Directory.GetFiles(sub, "*.exe", SearchOption.TopDirectoryOnly); }
                        catch { return Enumerable.Empty<string>(); }
                    }))
                .Where(exe => !ExcludedExes.Contains(Path.GetFileName(exe)))
                .ToList();

            if (!exeFiles.Any()) return null;

            string folderName = Path.GetFileName(folder);

            // 1. Papka nomiga eng yaqin nomlangan .exe ni afzal ko'rish
            var exactMatch = exeFiles.FirstOrDefault(exe =>
                Path.GetFileNameWithoutExtension(exe).Equals(folderName, StringComparison.OrdinalIgnoreCase));
            if (exactMatch != null) return exactMatch;

            // 2. Hajmi eng katta bo'lgan .exe (o'yinning asosiy binar fayli)
            return exeFiles.OrderByDescending(exe =>
            {
                try { return new FileInfo(exe).Length; }
                catch { return 0; }
            }).FirstOrDefault();
        }
        catch
        {
            return null;
        }
    }

    private static string CleanGameTitle(string folderName, string exePath)
    {
        // 1. FileVersionInfo orqali tekshirish
        try
        {
            var fvi = FileVersionInfo.GetVersionInfo(exePath);
            if (!string.IsNullOrWhiteSpace(fvi.ProductName) && fvi.ProductName.Length > 2)
            {
                return fvi.ProductName.Trim();
            }
            if (!string.IsNullOrWhiteSpace(fvi.FileDescription) && fvi.FileDescription.Length > 2)
            {
                return fvi.FileDescription.Trim();
            }
        }
        catch { }

        // 2. Papka nomini tozalash (masalan: "Grand_Theft_Auto_V_Repack" -> "Grand Theft Auto V")
        string clean = folderName.Replace('_', ' ').Replace('-', ' ');
        clean = Regex.Replace(clean, @"(?i)\b(repack|rip|by|fitgirl|dodi|xatab|rg mechanics|v\d+(\.\d+)*)\b", "");
        clean = Regex.Replace(clean, @"\s+", " ").Trim();

        return string.IsNullOrWhiteSpace(clean) ? folderName : clean;
    }

    public static string DetectCategory(string title)
    {
        string t = title.ToLowerInvariant();

        if (t.Contains("counter-strike") || t.Contains("cs2") || t.Contains("csgo") ||
            t.Contains("valorant") || t.Contains("pubg") || t.Contains("call of duty") ||
            t.Contains("warzone") || t.Contains("apex") || t.Contains("point blank") ||
            t.Contains("battlefield") || t.Contains("rainbow six") || t.Contains("sniper") ||
            t.Contains("left 4 dead") || t.Contains("doom") || t.Contains("far cry"))
        {
            return "Otishma";
        }

        if (t.Contains("dota") || t.Contains("league of legends") || t.Contains("warcraft") ||
            t.Contains("starcraft") || t.Contains("age of empires") || t.Contains("civilization") ||
            t.Contains("heroes") || t.Contains("chess") || t.Contains("total war"))
        {
            return "MOBA / Strategiya";
        }

        if (t.Contains("fc 24") || t.Contains("fifa") || t.Contains("pes") ||
            t.Contains("forza") || t.Contains("need for speed") || t.Contains("nfs") ||
            t.Contains("rocket league") || t.Contains("nba") || t.Contains("f1") ||
            t.Contains("dirt") || t.Contains("crew") || t.Contains("asphalt"))
        {
            return "Sport & Poyga";
        }

        if (t.Contains("chrome") || t.Contains("discord") || t.Contains("telegram") ||
            t.Contains("steam") || t.Contains("epic") || t.Contains("browser") ||
            t.Contains("spotify") || t.Contains("obs"))
        {
            return "Ilovalar & Brauzerlar";
        }

        return "Barchasi";
    }
}
