using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace NetCafeClient.Models;

/// <summary>
/// Bar / Snack mahsuloti modeli — Kiosk bar menyusi va savatcha uchun.
/// </summary>
public class SnackItem : INotifyPropertyChanged
{
    private int _orderQuantity = 0;

    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = "Ichimliklar"; // Energetiklar, Ichimliklar, Gazaklar, Fast-Food, Kofe
    public double Price { get; set; }
    public string Volume { get; set; } = string.Empty; // 250 ml, 140 g, 1 dona
    public string Description { get; set; } = string.Empty;
    public string IconEmoji { get; set; } = "🥤";
    public string Badge { get; set; } = string.Empty; // HOT, XIT, YANGI
    public string BadgeColor { get; set; } = "#F43F5E";
    public string GradientStart { get; set; } = "#1E293B";
    public string GradientEnd { get; set; } = "#0F172A";

    public bool HasBadge => !string.IsNullOrWhiteSpace(Badge);

    public int OrderQuantity
    {
        get => _orderQuantity;
        set
        {
            if (_orderQuantity != value)
            {
                _orderQuantity = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(TotalCost));
                OnPropertyChanged(nameof(HasOrders));
            }
        }
    }

    public double TotalCost => _orderQuantity * Price;
    public bool HasOrders => _orderQuantity > 0;

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
