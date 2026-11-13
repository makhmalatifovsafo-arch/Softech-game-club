using System;
using System.IO;
using System.Text;

namespace Softech.Updates;

public static class BoundedLog
{
    public const long MaxBytes = 2 * 1024 * 1024;
    private static readonly object Gate = new();
    public static void Append(string file, string message)
    {
        lock (Gate) try
        {
            // One pathological exception must not defeat rotation.
            if (message.Length > 16000) message = message[..16000] + " [truncated]";
            string line = $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}";
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            if (File.Exists(file) && new FileInfo(file).Length + Encoding.UTF8.GetByteCount(line) > MaxBytes)
            {
                if (new FileInfo(file).Length > MaxBytes)
                {
                    // Upgrade from older, unbounded logging: keep its latest
                    // diagnostic tail without loading a huge log into memory.
                    byte[] tail = new byte[(int)MaxBytes];
                    using (var input = File.OpenRead(file)) { input.Seek(-MaxBytes,SeekOrigin.End); input.ReadExactly(tail); }
                    File.WriteAllBytes(file + ".previous",tail);
                    File.Delete(file);
                }
                else File.Move(file, file + ".previous", true);
            }
            File.AppendAllText(file, line, new UTF8Encoding(false));
        }
        catch { /* Diagnostics must not crash the running application. */ }
    }
}
