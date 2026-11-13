using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Softech.Updates;

public static class UpdateStorage
{
    // Bind cached extracted files to the downloaded archive hash. Revalidate
    // every managed file before reusing a package after an application restart.
    public static string? FindStaged(string root, string version, string kind, string archiveHash)
    {
        string staging = PackageManifest.ChildPath(root, "updates/staging");
        if (!Directory.Exists(staging)) return null;
        foreach (string directory in Directory.EnumerateDirectories(staging))
        {
            string name = Path.GetFileName(directory), prefix = "v" + version + "-";
            if (!name.StartsWith(prefix,StringComparison.Ordinal) || !Guid.TryParse(name[prefix.Length..],out _)) continue;
            try
            {
                string receipt = PackageManifest.ChildPath(root,"updates/staging/"+name+"/download-receipt.json");
                using var json = JsonDocument.Parse(File.ReadAllText(receipt));
                if (!string.Equals(json.RootElement.GetProperty("sha256").GetString(),archiveHash,StringComparison.OrdinalIgnoreCase)) continue;
                string source = PackageManifest.ChildPath(root,"updates/staging/"+name+"/package");
                PackageManifest.Validate(source,version,kind);
                return source;
            }
            catch { /* Invalid cache must not become an installable update. */ }
        }
        return null;
    }

    public const long ReserveBytes = 256L * 1024 * 1024;
    public const long MaxDownloadBytes = 1024L * 1024 * 1024;
    public const long MaxExpandedBytes = 4L * 1024 * 1024 * 1024;

    public static void EnsureFreeSpace(string directory, long bytes, Func<long>? available = null)
    {
        if (bytes < 0) throw new InvalidDataException("Invalid package size.");
        long free = available?.Invoke() ?? new DriveInfo(Path.GetPathRoot(Path.GetFullPath(directory))!).AvailableFreeSpace;
        if (free < checked(bytes + ReserveBytes))
            throw new IOException("Yangilanish uchun diskda bo'sh joy yetarli emas. Joy bo'shatib qayta urinib ko'ring.");
    }

    public static async Task DownloadAsync(Stream source, string destination, long? length, CancellationToken token)
    {
        if (length < 0 || length > MaxDownloadBytes) throw new InvalidDataException("Update download is too large.");
        string directory = Path.GetDirectoryName(destination)!;
        EnsureFreeSpace(directory, length ?? 0);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        byte[] buffer = new byte[64 * 1024];
        long total = 0, checkedAt = 0;
        int count;
        while ((count = await source.ReadAsync(buffer, token)) != 0)
        {
            total += count;
            if (total > MaxDownloadBytes || (length.HasValue && total > length.Value))
                throw new InvalidDataException("Update download exceeds its size limit.");
            if (checkedAt == 0 || total - checkedAt >= 4 * 1024 * 1024)
            {
                EnsureFreeSpace(directory, length.HasValue ? Math.Max(count, length.Value - output.Length) : count);
                checkedAt = total;
            }
            await output.WriteAsync(buffer.AsMemory(0, count), token);
        }
        if (length.HasValue && total != length.Value) throw new InvalidDataException("Incomplete update download.");
    }

    public static void CheckExtractionSpace(string zip, string target)
    {
        using var archive = ZipFile.OpenRead(zip);
        long total = 0;
        foreach (var entry in archive.Entries)
        {
            total = checked(total + entry.Length);
            if (total > MaxExpandedBytes) throw new InvalidDataException("Expanded update is too large.");
        }
        EnsureFreeSpace(target, total);
    }
}
