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
        InitializeCatalog();
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
    private void InitializeCatalog()
    {
        _allProducts.Clear();

        var products = new List<SnackItem>
        {
            // --- ENERGETIKLAR ---
            new()
            {
                Id = 1,
                Name = "Red Bull Energy Drink",
                Category = "Energetik",
                Volume = "250 ml",
                Price = 22000,
                IconEmoji = "⚡",
                Badge = "XIT",
                BadgeColor = "#F59E0B",
                GradientStart = "#1E293B",
                GradientEnd = "#0F172A",
                Description = "Klassik quvvat baxsh etuvchi energetik ichimlik."
            },
            new()
            {
                Id = 2,
                Name = "Flash Up Energy",
                Category = "Energetik",
                Volume = "450 ml",
                Price = 12000,
                IconEmoji = "🔋",
                Badge = "HOT",
                BadgeColor = "#EF4444",
                GradientStart = "#450A0A",
                GradientEnd = "#1C1917",
                Description = "Katta hajm va kofeinli quvvat."
            },
            new()
            {
                Id = 3,
                Name = "Monster Energy Ultra",
                Category = "Energetik",
                Volume = "500 ml",
                Price = 28000,
                IconEmoji = "👹",
                Badge = "PREMIUM",
                BadgeColor = "#10B981",
                GradientStart = "#064E3B",
                GradientEnd = "#022C22",
                Description = "Shakarsiz yengil muzdek energetik."
            },
            new()
            {
                Id = 4,
                Name = "Gorilla Energy Drink",
                Category = "Energetik",
                Volume = "450 ml",
                Price = 14000,
                IconEmoji = "🦍",
                Badge = "HOT",
                BadgeColor = "#D97706",
                GradientStart = "#451A03",
                GradientEnd = "#18181B",
                Description = "Portlovchi kiber quvvat."
            },

            // --- SALQIN ICHIMLIKLAR ---
            new()
            {
                Id = 5,
                Name = "Coca-Cola Classic",
                Category = "Ichimlik",
                Volume = "0.5 L",
                Price = 9000,
                IconEmoji = "🥤",
                Badge = "KLASSIKA",
                BadgeColor = "#DC2626",
                GradientStart = "#450A0A",
                GradientEnd = "#1C1917",
                Description = "Muzday klassik gazlangan ichimlik."
            },
            new()
            {
                Id = 6,
                Name = "Fanta Orange",
                Category = "Ichimlik",
                Volume = "0.5 L",
                Price = 9000,
                IconEmoji = "🍊",
                Badge = "APELSIN",
                BadgeColor = "#EA580C",
                GradientStart = "#431407",
                GradientEnd = "#1C1917",
                Description = "Yorqin apelsin ta'mi."
            },
            new()
            {
                Id = 7,
                Name = "Sprite Lemon-Lime",
                Category = "Ichimlik",
                Volume = "0.5 L",
                Price = 9000,
                IconEmoji = "🍋",
                Badge = "MUZDAY",
                BadgeColor = "#16A34A",
                GradientStart = "#14532D",
                GradientEnd = "#052E16",
                Description = "Chanqovbosdi limon va laym."
            },
            new()
            {
                Id = 8,
                Name = "Suv Nestlé Pure Life",
                Category = "Ichimlik",
                Volume = "0.5 L",
                Price = 4000,
                IconEmoji = "💧",
                Badge = "TOZA",
                BadgeColor = "#0284C7",
                GradientStart = "#0C4A6E",
                GradientEnd = "#082F49",
                Description = "Gazsiz toza tog' suvi."
            },

            // --- GAZAKLAR & CHIPSLAR ---
            new()
            {
                Id = 9,
                Name = "Lays Maxx Cheese & Onion",
                Category = "Snack",
                Volume = "120 g",
                Price = 16000,
                IconEmoji = "🥔",
                Badge = "XIT",
                BadgeColor = "#EAB308",
                GradientStart = "#713F12",
                GradientEnd = "#1C1917",
                Description = "Qovurg'ali pishloqli qarsildoq chips."
            },
            new()
            {
                Id = 10,
                Name = "Doritos Nacho Cheese",
                Category = "Snack",
                Volume = "100 g",
                Price = 18000,
                IconEmoji = "🔺",
                Badge = "XIT",
                BadgeColor = "#EA580C",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                Description = "Makkajo'xori qarsildog'i va nacho sousi."
            },
            new()
            {
                Id = 11,
                Name = "Pringles Original",
                Category = "Snack",
                Volume = "165 g",
                Price = 32000,
                IconEmoji = "🥫",
                Badge = "PREMIUM",
                BadgeColor = "#DC2626",
                GradientStart = "#450A0A",
                GradientEnd = "#18181B",
                Description = "Naychada joylashgan qarsildoq kartoshka."
            },
            new()
            {
                Id = 12,
                Name = "Krutonlar Xrusteam Baget",
                Category = "Snack",
                Volume = "60 g",
                Price = 8000,
                IconEmoji = "🥖",
                Badge = "ARZON",
                BadgeColor = "#6366F1",
                GradientStart = "#1E1B4B",
                GradientEnd = "#0F172A",
                Description = "Yumshoq xushbo'y quritilgan nonlar."
            },

            // --- FAST-FOOD & SENDVICHLAR ---
            new()
            {
                Id = 13,
                Name = "Klab Sendvich Tovuqli",
                Category = "FastFood",
                Volume = "Katta",
                Price = 28000,
                IconEmoji = "🥪",
                Badge = "TO'YIMLI",
                BadgeColor = "#16A34A",
                GradientStart = "#14532D",
                GradientEnd = "#052E16",
                Description = "Qovurilgan tovuq go'shti, pishloq va sous."
            },
            new()
            {
                Id = 14,
                Name = "Hot-Dog Dabl Sosiska",
                Category = "FastFood",
                Volume = "Standart",
                Price = 22000,
                IconEmoji = "🌭",
                Badge = "ISSICHIQ",
                BadgeColor = "#E11D48",
                GradientStart = "#4C0519",
                GradientEnd = "#1C1917",
                Description = "Ikkita sersuv sosiska va xantal sousi."
            },
            new()
            {
                Id = 15,
                Name = "Burger Go'shtli (Klassik)",
                Category = "FastFood",
                Volume = "1 dona",
                Price = 34000,
                IconEmoji = "🍔",
                Badge = "XIT",
                BadgeColor = "#D97706",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                Description = "100% mol go'shti va qovurilgan bulochka."
            },

            // --- QAYNOQ KOFE & CHOY ---
            new()
            {
                Id = 16,
                Name = "Kofe Americano (Issiq)",
                Category = "Kofe",
                Volume = "250 ml",
                Price = 10000,
                IconEmoji = "☕",
                Badge = "QAYNOQ",
                BadgeColor = "#78350F",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                Description = "Yangi tuyilgan donalardan tayyorlangan kofe."
            },
            new()
            {
                Id = 17,
                Name = "Kofe Cappuccino (Ko'pikli)",
                Category = "Kofe",
                Volume = "300 ml",
                Price = 14000,
                IconEmoji = "🥛",
                Badge = "SUTLI",
                BadgeColor = "#B45309",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                Description = "Qalin sut ko'pigi bilan xushbo'y espresso."
            },
            new()
            {
                Id = 18,
                Name = "Ko'k Choy Limon Bilan",
                Category = "Kofe",
                Volume = "Choynak",
                Price = 8000,
                IconEmoji = "🍵",
                Badge = "CHANQOV",
                BadgeColor = "#15803D",
                GradientStart = "#14532D",
                GradientEnd = "#052E16",
                Description = "Issiq xushbo'y damlangan ko'k choy."
            }
        };

        foreach (var p in products)
        {
            _allProducts.Add(p);
        }
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

        // 1. WebSocket orqali serverga jo'natish
        if (_wsService != null)
        {
            try
            {
                await _wsService.SendBarOrderAsync(pcNumberStr, itemsPayload, totalAmount, paymentOption, note);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BarShop] WebSocket jo'natishda xato: {ex.Message}");
            }
        }

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
