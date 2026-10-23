using System;
using System.Diagnostics;

namespace NetCafeClient;

/// <summary>
/// ProcessCleanerService — O'yinlar, brauzerlar va ruxsatsiz dasturlarni majburan yopish.
/// Qulflash yoki seans yakunlanishida chaqiriladi.
/// </summary>
public static class ProcessCleaner
{
    /// <summary>O'ldirilishi kerak bo'lgan jarayon nomlari (kichik harf, kengaytmasiz)</summary>
    private static readonly string[] Targets =
    {
        // --- O'yinlar ---
        "cs2", "csgo", "dota2", "steam", "steamwebhelper", "gameoverlayui",
        "epicgameslauncher", "fortnite", "gta5", "RocketLeague",
        "LeagueClient", "LeagueClientUx", "LeagueClientUxRender",
        "valorant", "VALORANT-Win64-Shipping",
        "minecraft.windows", "javaw",

        // --- Brauzerlar ---
        "chrome", "msedge", "firefox", "opera", "brave", "vivaldi",

        // --- Messenjerlar va ijtimoiy tarmoqlar ---
        "telegram", "discord", "skype", "slack",

        // --- Tizim xavflilari ---
        "taskmgr", "regedit", "cmd", "powershell", "pwsh", "mmc",
        "mspaint", "notepad", "wordpad",

        // --- Remote access ---
        "TeamViewer", "AnyDesk", "vnc"
    };

    /// <summary>Barcha maqsadli jarayonlarni topib o'ldirish</summary>
    public static void CleanGameProcesses()
    {
        foreach (string name in Targets)
        {
            try
            {
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try
                    {
                        if (!p.HasExited)
                        {
                            p.Kill(entireProcessTree: true);
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[ProcessCleaner] {name} o'ldirishda xato: {ex.Message}");
                    }
                    finally
                    {
                        p.Dispose();
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ProcessCleaner] GetProcessesByName({name}) xato: {ex.Message}");
            }
        }
    }
}
