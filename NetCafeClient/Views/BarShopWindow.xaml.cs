using System.Net.Http;
using System.Text.Json;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using NetCafeClient.Models;

using Button = System.Windows.Controls.Button;
using RadioButton = System.Windows.Controls.RadioButton;
using TextBox = System.Windows.Controls.TextBox;
using WpfMessageBox = System.Windows.MessageBox;

namespace NetCafeClient.Views;

/// <summary>
/// BarShopWindow — Kiosk ichidagi Bar va Snack do'koni.
/// Mijozlar o'rindiqdan turmasdan ichimlik va gazaklarni tanlab, to'lov usulini
/// (kompyuter hisobi, mijoz balansi yoki naqd) belgilab real-time buyurtma beradi.
/// </summary>
public partial class BarShopWindow : Window
{
    private readonly ObservableCollection<SnackItem> _allProducts = new();
    private readonly ObservableCollection<SnackItem> _filteredProducts = new();
    private readonly ObservableCollection<SnackItem> _cartItems = new();

    private readonly WebSocketClientService? _wsService;
    private readonly DispatcherTimer _autoCloseTimer;

    private int _pcNumber = 1;
    private string _memberUsername = "Mehmon";
    private double _memberBalance = 0;
    private bool _isMemberSession = false;

    private string _currentCategory = "ALL";
    private string _currentSearch = string.Empty;
    private const string DefaultNotePlaceholder = "Eslatma (masalan: sovuqroq bo'lsin, shakar solinmasin)";

    public event Action<string, double, string, string>? OnOrderPlaced;

    public BarShopWindow(WebSocketClientService? wsService = null, int pcNumber = 1, string memberUsername = "Mehmon", double memberBalance = 0, bool isMember = false)
    {
        InitializeComponent();
        Width = Math.Min(1060, Math.Max(320, SystemParameters.WorkArea.Width - 24));
        Height = Math.Min(700, Math.Max(320, SystemParameters.WorkArea.Height - 24));

        _wsService = wsService;
        _pcNumber = pcNumber;
        _memberUsername = memberUsername;
        _memberBalance = memberBalance;
        _isMemberSession = isMember;

        CatalogItemsControl.ItemsSource = _filteredProducts;
        CartItemsControl.ItemsSource = _cartItems;

        _autoCloseTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _autoCloseTimer.Tick += (s, e) =>
        {
            _autoCloseTimer.Stop();
            Close();
        };

        UpdateHeaderInfo();
        Loaded += async (_, _) => await InitializeCatalogAsync();
        ApplyFilter();
        UpdateCartSummary();
    }

    public void SetClientContext(int pcNumber, string customerName, double balance, bool isMember)
    {
        _pcNumber = pcNumber;
        _memberUsername = customerName;
        _memberBalance = balance;
        _isMemberSession = isMember;

        UpdateHeaderInfo();
    }

    private void UpdateHeaderInfo()
    {
        TxtPcNumber.Text = $"PC-{_pcNumber:D2}";
        if (_isMemberSession)
        {
            TxtMemberBalance.Text = $"💳 Balans: {_memberBalance:N0} UZS";
            TxtMemberBalance.Visibility = Visibility.Visible;
            TxtBalanceNotice.Text = $"Mavjud: {_memberBalance:N0} UZS (Darhol hisobdan yechiladi)";
        }
        else
        {
            TxtMemberBalance.Text = "👤 Mehmon Seansi";
            TxtMemberBalance.Visibility = Visibility.Visible;
            TxtBalanceNotice.Text = "Faqat ro'yxatdan o'tgan a'zolar uchun";
        }
    }

    // =========================================================================
    // 1. BAR KATALOGINI TO'LDIRISH
    // =========================================================================
    private async Task InitializeCatalogAsync()
    {
        _allProducts.Clear();
        try
        {
            if (_wsService == null) throw new InvalidOperationException("Server bilan aloqa yoq.");
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            var json = await http.GetStringAsync(_wsService.ServerHttpUrl + "/api/client/bar/catalog");
            using var doc = JsonDocument.Parse(json);
            foreach (var item in doc.RootElement.GetProperty("items").EnumerateArray())
            {
                _allProducts.Add(new SnackItem {
                    Id = item.GetProperty("id").GetInt32(),
                    Name = item.GetProperty("name").GetString() ?? "",
                    Price = item.GetProperty("sell_price").GetDouble(),
                    Category = item.GetProperty("category").GetString()?.ToUpperInvariant() switch {
                        "SNACKS" or "SNACK" => "Snack", "ENERGY" or "ENERGETIK" => "Energetik",
                        "FASTFOOD" or "FAST_FOOD" or "FOOD" => "FastFood", "COFFEE" or "KOFE" => "Kofe", _ => "Ichimlik"
                    },
                    IconEmoji = "🛒", GradientStart = "#1E293B", GradientEnd = "#0F172A",
                    Description = "Klub omboridagi mahsulot"
                });
            }
            ApplyFilter();
        }
        catch (Exception ex) { WpfMessageBox.Show("Bar menyusi yuklanmadi: " + ex.Message); }
    }

    // =========================================================================
    // 2. QIDIRUV VA TOIFALARNI FILTRLASH
    // =========================================================================
    private void CategoryTab_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton rb && rb.Tag is string tag)
        {
            _currentCategory = tag;
            ApplyFilter();
        }
    }

    private void TxtSearch_TextChanged(object sender, TextChangedEventArgs e)
    {
        _currentSearch = TxtSearch.Text.Trim().ToLowerInvariant();
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        _filteredProducts.Clear();

        var query = _allProducts.AsEnumerable();

        if (_currentCategory == "ENERGETIK")
            query = query.Where(p => p.Category.Equals("Energetik", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "ICHIMLIK")
            query = query.Where(p => p.Category.Equals("Ichimlik", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "SNACK")
            query = query.Where(p => p.Category.Equals("Snack", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "FASTFOOD")
            query = query.Where(p => p.Category.Equals("FastFood", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "KOFE")
            query = query.Where(p => p.Category.Equals("Kofe", StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(_currentSearch))
        {
            query = query.Where(p =>
                p.Name.Contains(_currentSearch, StringComparison.OrdinalIgnoreCase) ||
                p.Description.Contains(_currentSearch, StringComparison.OrdinalIgnoreCase) ||
                p.Category.Contains(_currentSearch, StringComparison.OrdinalIgnoreCase));
        }

        foreach (var item in query)
        {
            _filteredProducts.Add(item);
        }
    }

    // =========================================================================
    // 3. SAVATCHA (CART) BOSHQARUVI
    // =========================================================================
    private void BtnAddToCart_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SnackItem product)
        {
            var cartItem = _cartItems.FirstOrDefault(c => c.Id == product.Id);
            if (cartItem == null)
            {
                product.OrderQuantity = 1;
                _cartItems.Add(product);
            }
            else
            {
                cartItem.OrderQuantity++;
            }

            UpdateCartSummary();
        }
    }

    private void BtnPlusCart_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SnackItem item)
        {
            item.OrderQuantity++;
            UpdateCartSummary();
        }
    }

    private void BtnMinusCart_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SnackItem item)
        {
            if (item.OrderQuantity > 1)
            {
                item.OrderQuantity--;
            }
            else
            {
                item.OrderQuantity = 0;
                _cartItems.Remove(item);
            }
            UpdateCartSummary();
        }
    }

    private void BtnClearCart_Click(object sender, RoutedEventArgs e)
    {
        foreach (var item in _cartItems)
        {
            item.OrderQuantity = 0;
        }
        _cartItems.Clear();
        UpdateCartSummary();
    }

    private void UpdateCartSummary()
    {
        int totalItemsCount = _cartItems.Sum(c => c.OrderQuantity);
        double totalSum = _cartItems.Sum(c => c.TotalCost);

        TxtCartItemCount.Text = $"{totalItemsCount} ta";
        TxtTotalSum.Text = $"{totalSum:N0} UZS";

        if (totalItemsCount > 0)
        {
            EmptyCartPanel.Visibility = Visibility.Collapsed;
            CartScrollViewer.Visibility = Visibility.Visible;
            BtnSubmitOrder.IsEnabled = true;
        }
        else
        {
            EmptyCartPanel.Visibility = Visibility.Visible;
            CartScrollViewer.Visibility = Visibility.Collapsed;
            BtnSubmitOrder.IsEnabled = false;
        }
    }

    // =========================================================================
    // 4. BUYURTMA BERISH VA WEBSOCKET INTEROP
    // =========================================================================
    private async void BtnSubmitOrder_Click(object sender, RoutedEventArgs e)
    {
        if (!_cartItems.Any())
        {
            WpfMessageBox.Show("Savatingiz bo'sh! Iltimos, avval mahsulot tanlang.", "Xabar", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        double totalAmount = _cartItems.Sum(c => c.TotalCost);

        // Tanlangan to'lov usulini aniqlash
        string paymentOption = "ON_PC_SESSION";
        string paymentDisplayName = "Kompyuter hisobiga qo'shildi (Kassada to'lanadi)";

        if (RbFromMemberBalance.IsChecked == true)
        {
            paymentOption = "FROM_MEMBER_BALANCE";
            paymentDisplayName = "Shaxsiy hisobingizdan yechildi";

            if (!_isMemberSession)
            {
                WpfMessageBox.Show("Siz mehmon seansidasiz. Shaxsiy balansdan to'lash faqat a'zo mijozlar uchun amal qiladi.\nIltimos, boshqa to'lov usulini tanlang.",
                    "To'lov Xatoligi", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (_memberBalance < totalAmount)
            {
                WpfMessageBox.Show($"Hisobingizda mablag' yetarli emas!\nMavjud: {_memberBalance:N0} UZS\nBuyurtma: {totalAmount:N0} UZS",
                    "Balans Yetarli Emas", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
        }
        else if (RbCashToAdmin.IsChecked == true)
        {
            paymentOption = "CASH_TO_ADMIN";
            paymentDisplayName = "Naqd pul (Kassir keltirganda to'lanadi)";
        }

        string rawNote = TxtOrderNote.Text.Trim();
        string note = rawNote == DefaultNotePlaceholder ? "" : rawNote;

        // JSON payload tayyorlash
        string pcNumberStr = $"PC-{_pcNumber:D2}";
        var itemsPayload = _cartItems.Select(c => new
        {
            id = c.Id,
            name = c.Name,
            quantity = c.OrderQuantity,
            price = c.Price,
            total = c.TotalCost
        }).ToList();

        BtnSubmitOrder.IsEnabled = false;
        try
        {
            if (_wsService == null) throw new InvalidOperationException("Server bilan aloqa yoq.");
            await _wsService.SendBarOrderAsync(pcNumberStr, itemsPayload, totalAmount, paymentOption, note);
        }
        catch (Exception ex)
        {
            WpfMessageBox.Show("Buyurtma qabul qilinmadi: " + ex.Message);
            BtnSubmitOrder.IsEnabled = true;
            return;
        }
        paymentDisplayName = "Kassir tasdiqlashi kutilmoqda";

        // 2. Hodisani chaqirish
        string summaryText = string.Join(", ", _cartItems.Select(c => $"{c.Name} x{c.OrderQuantity}"));
        OnOrderPlaced?.Invoke(summaryText, totalAmount, paymentOption, note);

        // 3. Ekranda Tasdiqlash oynasini ko'rsatish
        TxtConfirmPc.Text = pcNumberStr;
        TxtConfirmPayment.Text = paymentDisplayName;
        TxtConfirmTotal.Text = $"{totalAmount:N0} UZS";

        ConfirmationOverlay.Visibility = Visibility.Visible;
        _autoCloseTimer.Start();

        // Savatni tozalash
        foreach (var item in _cartItems)
        {
            item.OrderQuantity = 0;
        }
        _cartItems.Clear();
        UpdateCartSummary();
    }

    private void BtnCloseConfirmation_Click(object sender, RoutedEventArgs e)
    {
        _autoCloseTimer.Stop();
        Close();
    }

    private void BtnClose_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void Window_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
    }

    private void TxtOrderNote_GotFocus(object sender, RoutedEventArgs e)
    {
        if (TxtOrderNote.Text == DefaultNotePlaceholder)
        {
            TxtOrderNote.Text = "";
            TxtOrderNote.Foreground = System.Windows.Media.Brushes.White;
        }
    }

    private void TxtOrderNote_LostFocus(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(TxtOrderNote.Text))
        {
            TxtOrderNote.Text = DefaultNotePlaceholder;
            TxtOrderNote.Foreground = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(100, 116, 139));
        }
    }
}
