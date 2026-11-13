using System.IO;
using System.IO.Compression;

namespace Softech.Updates;

public static class SafePackageExtraction
{
    public static void Extract(string zip, string target)
    {
        UpdateStorage.CheckExtractionSpace(zip, target);
        using var archive = ZipFile.OpenRead(zip);
        // Check every destination before replacing any application file.
        foreach (var entry in archive.Entries)
            PackageManifest.ChildPath(target, entry.FullName.TrimEnd('/'));
        foreach (var entry in archive.Entries)
        {
            string relative = entry.FullName.Replace('\\', '/');
            if (PackageManifest.Preserved(relative)) continue;
            string destination = PackageManifest.ChildPath(target, relative.TrimEnd('/'));
            if (relative.EndsWith('/')) { Directory.CreateDirectory(destination); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, overwrite: true);
        }
    }
}
