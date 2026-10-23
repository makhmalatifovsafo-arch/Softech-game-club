using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using NetCafeClient.Models;

using DrawingIcon = System.Drawing.Icon;
using DrawingBitmap = System.Drawing.Bitmap;
using ImageFormat = System.Drawing.Imaging.ImageFormat;
using DrawingGraphics = System.Drawing.Graphics;
using DrawingColor = System.Drawing.Color;
using DrawingFont = System.Drawing.Font;
using DrawingSolidBrush = System.Drawing.SolidBrush;
using DrawingStringFormat = System.Drawing.StringFormat;

namespace NetCafeClient.Services.Games;

/// <summary>
/// GameMetadataService — O'yinlar uchun avtomatik Cover Art (poster) va metadata scraper.
/// Steam CDN (600x900 library posters), Steam Store Search API orqali yuqori sifatli
/// rasmlarni yuklaydi, lokal Cache papkasiga saqlaydi hamda internet bo'lmaganda
/// .exe faylidan 256x256 Hi-Res Icon ajratib oladi.
/// </summary>
public class GameMetadataService
{
    private static readonly Lazy<GameMetadataService> _instance = new(() => new GameMetadataService());
    public static GameMetadataService Instance => _instance.Value;

    private readonly HttpClient _httpClient;
    private readonly string _cacheDirectory;

    // Win32 Hi-Res Icon Extraction API (256x256 iconlarni ajratish)
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int PrivateExtractIcons(
        string lpszFile,
        int nIconIndex,
        int cxIcon,
        int cyIcon,
        IntPtr[] phicon,
        int[] piconid,
        int nIcons,
        int flags);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public GameMetadataService()
    {
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(8)
        };
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoftechGameKiosk/2.4");

        // Lokal kesh papkasi: [AppDir]/Cache/Covers
        _cacheDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Cache", "Covers");
        if (!Directory.Exists(_cacheDirectory))
        {
            try { Directory.CreateDirectory(_cacheDirectory); }
            catch (Exception ex) { Debug.WriteLine($"[GameMetadata] Kesh papkasi yaratishda xato: {ex.Message}"); }
        }
    }

    /// <summary>
    /// O'yin uchun poster rasmini topish, keshga yuklash va GameItem ga biriktirish
    /// </summary>
    public async Task<string?> FetchAndCacheCoverArtAsync(GameItem game)
    {
        if (game == null) return null;

        string safeName = MakeSafeFileName(string.IsNullOrWhiteSpace(game.AppId) ? game.Title : $"{game.Platform}_{game.AppId}");
        string localJpgPath = Path.Combine(_cacheDirectory, $"{safeName}.jpg");
        string localPngPath = Path.Combine(_cacheDirectory, $"{safeName}.png");

        // 1. Agar lokal keshda rasm allaqachon mavjud bo'lsa, qaytarish
        if (File.Exists(localJpgPath))
        {
            game.PosterPath = localJpgPath;
            return localJpgPath;
        }
        if (File.Exists(localPngPath))
        {
            game.PosterPath = localPngPath;
            return localPngPath;
        }

        // 2. Steam O'yinlari uchun to'g'ridan-to'g'ri Steam CDN dan yuklab olish
        if (game.Platform.Equals("Steam", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(game.AppId))
        {
            string steamCdnUrl = $"https://cdn.cloudflare.steamstatic.com/steam/apps/{game.AppId}/library_600x900.jpg";
            bool downloaded = await DownloadImageAsync(steamCdnUrl, localJpgPath);

            if (!downloaded)
            {
                // Fallback: header.jpg
                string headerUrl = $"https://steamcdn-a.akamaihd.net/steam/apps/{game.AppId}/header.jpg";
                downloaded = await DownloadImageAsync(headerUrl, localJpgPath);
            }

            if (downloaded)
            {
                game.PosterPath = localJpgPath;
                return localJpgPath;
            }
        }

        // 3. Non-Steam (Epic, Riot, Custom) o'yinlar uchun: Steam Store Search API orqali qidirish
        try
        {
            string cleanTitle = CleanTitleForSearch(game.Title);
            string searchUrl = $"https://store.steampowered.com/api/storesearch/?term={Uri.EscapeDataString(cleanTitle)}&l=english&cc=US";

            string json = await _httpClient.GetStringAsync(searchUrl);
            using var doc = JsonDocument.Parse(json);

            if (doc.RootElement.TryGetProperty("items", out var itemsElem) && itemsElem.GetArrayLength() > 0)
            {
                var firstItem = itemsElem[0];
                if (firstItem.TryGetProperty("id", out var idElem))
                {
                    int foundAppId = idElem.GetInt32();
                    string cdnUrl = $"https://cdn.cloudflare.steamstatic.com/steam/apps/{foundAppId}/library_600x900.jpg";
                    bool downloaded = await DownloadImageAsync(cdnUrl, localJpgPath);

                    if (!downloaded)
                    {
                        string headerUrl = $"https://steamcdn-a.akamaihd.net/steam/apps/{foundAppId}/header.jpg";
                        downloaded = await DownloadImageAsync(headerUrl, localJpgPath);
                    }

                    if (downloaded)
                    {
                        game.PosterPath = localJpgPath;
                        return localJpgPath;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GameMetadata] Online qidiruvda xato ({game.Title}): {ex.Message}");
        }

        // 4. OFFLINE / FALLBACK: .EXE faylidan Hi-Res piktogrammani ajratib olib poster yaratish
        string? iconPosterPath = ExtractHiResIconAsPoster(game, localPngPath);
        if (!string.IsNullOrEmpty(iconPosterPath))
        {
            game.PosterPath = iconPosterPath;
            return iconPosterPath;
        }

        return null;
    }

    /// <summary>
    /// URL dan rasmni yuklab diskka saqlash
    /// </summary>
    private async Task<bool> DownloadImageAsync(string url, string destinationPath)
    {
        try
        {
            var response = await _httpClient.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (bytes.Length > 2048) // Kamida 2 KB (haqiqiy rasm)
                {
                    await File.WriteAllBytesAsync(destinationPath, bytes);
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GameMetadata] Rasm yuklashda xato ({url}): {ex.Message}");
        }

        return false;
    }

    /// <summary>
    /// Internet bo'lmaganda: .EXE fayli ichidan 256x256 Hi-Res Icon ni ajratib olib,
    /// zamonaviy 3:4 vertikal poster kartochkasiga joylashtirib diskka saqlash.
    /// </summary>
    public string? ExtractHiResIconAsPoster(GameItem game, string targetPath)
    {
        string? exePath = GetValidExecutablePath(game);
        if (string.IsNullOrEmpty(exePath) || !File.Exists(exePath))
            return null;

        try
        {
            DrawingIcon? extractedIcon = null;

            // 1. Win32 PrivateExtractIcons orqali 256x256 piktogrammani ajratish
            IntPtr[] phicon = new IntPtr[1];
            int[] piconid = new int[1];

            int count = PrivateExtractIcons(exePath, 0, 256, 256, phicon, piconid, 1, 0);
            if (count > 0 && phicon[0] != IntPtr.Zero)
            {
                try
                {
                    extractedIcon = (DrawingIcon)DrawingIcon.FromHandle(phicon[0]).Clone();
                }
                finally
                {
                    DestroyIcon(phicon[0]);
                }
            }

            // 2. Fallback: Standart Icon.ExtractAssociatedIcon
            if (extractedIcon == null)
            {
                extractedIcon = DrawingIcon.ExtractAssociatedIcon(exePath);
            }

            if (extractedIcon == null) return null;

            using (extractedIcon)
            using (var iconBmp = extractedIcon.ToBitmap())
            // 3:4 vertikal konsol posteri o'lchami: 300x400 px
            using (var poster = new DrawingBitmap(300, 400))
            using (var g = DrawingGraphics.FromImage(poster))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;

                // Qorong'u Cyber Gradient fon
                using (var brush = new System.Drawing.Drawing2D.LinearGradientBrush(
                    new System.Drawing.Rectangle(0, 0, 300, 400),
                    DrawingColor.FromArgb(24, 24, 32),
                    DrawingColor.FromArgb(10, 10, 14),
                    System.Drawing.Drawing2D.LinearGradientMode.Vertical))
                {
                    g.FillRectangle(brush, 0, 0, 300, 400);
                }

                // Markazda piktogrammani chizish (128x128 yoki 160x160)
                int iconSize = Math.Min(160, Math.Max(96, iconBmp.Width * 2));
                int iconX = (300 - iconSize) / 2;
                int iconY = 100;
                g.DrawImage(iconBmp, iconX, iconY, iconSize, iconSize);

                // Pastki qismda o'yin nomini chizish
                using (var font = new DrawingFont("Segoe UI", 12, System.Drawing.FontStyle.Bold))
                using (var textBrush = new DrawingSolidBrush(DrawingColor.White))
                {
                    var sf = new DrawingStringFormat
                    {
                        Alignment = System.Drawing.StringAlignment.Center,
                        LineAlignment = System.Drawing.StringAlignment.Center
                    };
                    g.DrawString(game.Title, font, textBrush, new System.Drawing.RectangleF(10, 310, 280, 60), sf);
                }

                poster.Save(targetPath, ImageFormat.Png);
            }

            return targetPath;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GameMetadata] Hi-Res Icon ajratishda xato ({exePath}): {ex.Message}");
            return null;
        }
    }

    private static string? GetValidExecutablePath(GameItem game)
    {
        if (!string.IsNullOrWhiteSpace(game.IconPath) && File.Exists(game.IconPath))
            return game.IconPath;

        if (!string.IsNullOrWhiteSpace(game.ExecutablePath) && File.Exists(game.ExecutablePath))
            return game.ExecutablePath;

        if (!string.IsNullOrWhiteSpace(game.InstallDirectory) && Directory.Exists(game.InstallDirectory))
        {
            try
            {
                return Directory.GetFiles(game.InstallDirectory, "*.exe", SearchOption.TopDirectoryOnly).FirstOrDefault();
            }
            catch { }
        }

        return null;
    }

    private static string CleanTitleForSearch(string title)
    {
        string clean = Regex.Replace(title, @"(?i)\b(edition|remastered|repack|goty|deluxe|bundle|online)\b", "");
        clean = Regex.Replace(clean, @"[:\-_]", " ");
        return clean.Trim();
    }

    private static string MakeSafeFileName(string name)
    {
        foreach (char c in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(c, '_');
        }
        return name.Replace(' ', '_');
    }
}
