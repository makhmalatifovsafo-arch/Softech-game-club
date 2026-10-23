using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;

namespace NetCafeClient.Models;

/// <summary>
/// O'yin kartochkasi modeli — Konsol darajasidagi poster, ma'lumotlar va ishga tushirish parametrlari.
/// </summary>
public class GameItem : INotifyPropertyChanged
{
    private bool _isRunning;
    private string _posterPath = string.Empty;

    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Category { get; set; } = "Barchasi";
    public string Description { get; set; } = string.Empty;
    public string PlayTimeHours { get; set; } = "0 soat";
    public string Badge { get; set; } = string.Empty; // HOT, TOP 1, YANGI, VIP
    public string BadgeColor { get; set; } = "#F43F5E"; // Crimson
    public string ExecutablePath { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public string PosterUri { get; set; } = string.Empty;
    public string IconGlyph { get; set; } = "🎮";
    public string GradientStart { get; set; } = "#1E1B4B";
    public string GradientEnd { get; set; } = "#0F172A";
    public string AccentColor { get; set; } = "#38BDF8";
    public double Rating { get; set; } = 4.9;

    // Skaner va Metadata kengaytmalari
    public string Platform { get; set; } = "Custom"; // Steam, Epic, Riot, Custom
    public string LaunchArgs { get; set; } = string.Empty;
    public string IconPath { get; set; } = string.Empty;
    public string AppId { get; set; } = string.Empty;
    public string InstallDirectory { get; set; } = string.Empty;
    public string CoverUrl { get; set; } = string.Empty;

    public string PosterPath
    {
        get => _posterPath;
        set
        {
            if (_posterPath != value)
            {
                _posterPath = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(HasPosterImage));
            }
        }
    }

    public bool HasBadge => !string.IsNullOrWhiteSpace(Badge);
    public bool HasPosterImage => !string.IsNullOrWhiteSpace(PosterPath) && File.Exists(PosterPath);

    public bool IsRunning
    {
        get => _isRunning;
        set
        {
            if (_isRunning != value)
            {
                _isRunning = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(StatusText));
            }
        }
    }

    public string StatusText => IsRunning ? "O'YIN DAVOM ETMOQDA" : "O'YNASH";

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
