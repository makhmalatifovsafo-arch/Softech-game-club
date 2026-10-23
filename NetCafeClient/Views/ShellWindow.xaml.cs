using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using NetCafeClient.Models;
using NetCafeClient.Services.Games;

using WpfColor = System.Windows.Media.Color;
using WpfBrushes = System.Windows.Media.Brushes;
using WpfApplication = System.Windows.Application;
using WpfMessageBox = System.Windows.MessageBox;
using Button = System.Windows.Controls.Button;
using RadioButton = System.Windows.Controls.RadioButton;
using TextBox = System.Windows.Controls.TextBox;

namespace NetCafeClient.Views;

/// <summary>
/// ShellWindow — Konsol darajasidagi zamonaviy Game Launcher va Windows Desktop Shell.
/// Faol seans davomida Windows Explorer ish stoli o'rnini egallaydi.
/// O'yin boshlanganda launcher minimal resurs bilan orqa fonga chekinadi, o'yin tugagach darhol oldinga qaytadi.
/// </summary>
public partial class ShellWindow : Window, System.ComponentModel.INotifyPropertyChanged
{
    public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs(name));

    private string _activeHourlyRateDisplay = "10 000 UZS / soat";
    public string ActiveHourlyRateDisplay
    {
        get => _activeHourlyRateDisplay;
        set
        {
            if (_activeHourlyRateDisplay != value)
            {
                _activeHourlyRateDisplay = value;
                OnPropertyChanged(nameof(ActiveHourlyRateDisplay));
            }
        }
    }

    public void SetZoneInfo(string zoneName, double pricePerHour, string? formattedRate = null)
    {
        Dispatcher.Invoke(() =>
        {
            ActiveHourlyRateDisplay = formattedRate ?? $"{pricePerHour:N0} UZS / soat".Replace(",", " ");
        });
    }
    // =========================================================================
    // WIN32 AUDIO & DESKTOP NATIVE INTEROP
    // =========================================================================
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    private const byte VK_VOLUME_MUTE = 0xAD;
    private const byte VK_VOLUME_DOWN = 0xAE;
    private const byte VK_VOLUME_UP = 0xAF;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    // =========================================================================
    // FIELDS & STATE
    // =========================================================================
    private readonly ObservableCollection<GameItem> _allGames = new();
    private readonly ObservableCollection<GameItem> _filteredGames = new();
    private readonly ObservableCollection<SnackItem> _snackItems = new();

    private readonly DispatcherTimer _sessionTimer;
    private readonly DispatcherTimer _toastTimer;
    private int _remainingSeconds = 0;
    private int _pcNumber = 1;
    private string _customerName = "Mehmon";
    private double _customerBalance = 0;
    private bool _isMemberSession = false;
    private string _currentCategory = "ALL";
    private string _currentSearchQuery = string.Empty;

    public event Action? OnLogoutRequested;
    public event Action<string>? OnAdminCallRequested;
    public event Action<string, double>? OnBarOrderSubmitted;

    public ShellWindow()
    {
        InitializeComponent();

        GamesItemsControl.ItemsSource = _filteredGames;
        SnacksItemsControl.ItemsSource = _snackItems;

        // Seans taymeri (har soniyada)
        _sessionTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _sessionTimer.Tick += SessionTimer_Tick;

        // Toast xabarlari taymeri (3.5 soniyadan keyin yopiladi)
        _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3.5) };
        _toastTimer.Tick += (s, e) =>
        {
            _toastTimer.Stop();
            ToastBanner.Visibility = Visibility.Collapsed;
        };

        // Boshlang'ich katalog ma'lumotlarini yuklash
        InitializeGameCatalog();
        InitializeSnackCatalog();
        ApplyFilter();

        Loaded += ShellWindow_Loaded;
    }

    private void ShellWindow_Loaded(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Maximized;
        Activate();

        // Fon rejimida lokal o'yinlarni skanerlash va rasmlarni keshga olish
        _ = ScanAndFetchGameMetadataAsync();
    }

    private async Task ScanAndFetchGameMetadataAsync()
    {
        try
        {
            // 1. Diskdagi lokal o'rnatilgan o'yinlarni aniqlash (Steam, Epic, Riot, Custom)
            List<GameItem>? scannedGames = null;
            try
            {
                scannedGames = await GameScannerService.Instance.ScanAllGamesAsync();
            }
            catch (Exception scanEx)
            {
                Debug.WriteLine($"[ShellWindow] GameScannerService xatosi (placeholderlar saqlanadi): {scanEx.Message}");
            }

            if (scannedGames != null && scannedGames.Count > 0)
            {
                Dispatcher.Invoke(() =>
                {
                    foreach (var game in scannedGames)
                    {
                        var existing = _allGames.FirstOrDefault(g =>
                            g.Title.Equals(game.Title, StringComparison.OrdinalIgnoreCase) ||
                            (!string.IsNullOrEmpty(g.AppId) && g.AppId.Equals(game.AppId, StringComparison.OrdinalIgnoreCase)));

                        if (existing != null)
                        {
                            existing.ExecutablePath = game.ExecutablePath;
                            existing.InstallDirectory = game.InstallDirectory;
                            existing.ProcessName = game.ProcessName;
                            existing.Platform = game.Platform;
                            existing.IconPath = game.IconPath;
                        }
                        else
                        {
                            _allGames.Add(game);
                        }
                    }
                    ApplyFilter();
                });
            }
            else
            {
                // Lokal o'yinlar topilmasa ham, toza placeholder kategoriyalar saqlanadi
                Dispatcher.Invoke(ApplyFilter);
            }

            // 2. Barcha o'yinlar uchun rasmlar va Hi-Res posterlarni fonda yuklash
            foreach (var game in _allGames.ToList())
            {
                if (!game.HasPosterImage)
                {
                    try
                    {
                        await GameMetadataService.Instance.FetchAndCacheCoverArtAsync(game);
                    }
                    catch { }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ShellWindow] Avtomatik skanerlashda xato: {ex.Message}");
            Dispatcher.Invoke(ApplyFilter);
        }
    }

    // =========================================================================
    // 1. GAME CATALOG INITIALIZATION (Konsol darajasidagi 25+ o'yinlar)
    // =========================================================================
    private void InitializeGameCatalog()
    {
        _allGames.Clear();

        var games = new List<GameItem>
        {
            // --- SHOOTERS ---
            new()
            {
                Id = 1,
                Title = "Counter-Strike 2",
                Category = "Otishma",
                Badge = "TOP 1",
                BadgeColor = "#F59E0B", // Amber gold
                PlayTimeHours = "384 soat",
                Description = "Dunyo bo'ylab eng mashhur 5v5 taktik FPS otishma o'yini.",
                IconGlyph = "🎯",
                GradientStart = "#1E293B",
                GradientEnd = "#0F172A",
                AccentColor = "#38BDF8",
                ProcessName = "cs2",
                ExecutablePath = "steam://rungameid/730"
            },
            new()
            {
                Id = 2,
                Title = "Valorant",
                Category = "Otishma",
                Badge = "HOT",
                BadgeColor = "#F43F5E",
                PlayTimeHours = "215 soat",
                Description = "Riot Games mahsuloti: qahramonlar va taktik otishma.",
                IconGlyph = "⚡",
                GradientStart = "#3B0764",
                GradientEnd = "#1E1B4B",
                AccentColor = "#F43F5E",
                ProcessName = "VALORANT-Win64-Shipping",
                ExecutablePath = "riotclient:"
            },
            new()
            {
                Id = 3,
                Title = "PUBG: Battlegrounds",
                Category = "Otishma",
                Badge = "HOT",
                BadgeColor = "#EA580C",
                PlayTimeHours = "165 soat",
                Description = "100 kishilik omon qolish va battle royale jangi.",
                IconGlyph = "🪂",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                AccentColor = "#F97316",
                ProcessName = "TslGame",
                ExecutablePath = "steam://rungameid/578080"
            },
            new()
            {
                Id = 4,
                Title = "Call of Duty: Warzone",
                Category = "Otishma",
                Badge = "POPULYAR",
                BadgeColor = "#10B981",
                PlayTimeHours = "128 soat",
                Description = "Massiv harbiy battle royale va DMZ rejimlari.",
                IconGlyph = "💥",
                GradientStart = "#064E3B",
                GradientEnd = "#022C22",
                AccentColor = "#10B981",
                ProcessName = "cod",
                ExecutablePath = "battlenet:"
            },
            new()
            {
                Id = 5,
                Title = "Apex Legends",
                Category = "Otishma",
                Badge = "TREND",
                BadgeColor = "#E11D48",
                PlayTimeHours = "92 soat",
                Description = "Tezkor dinamika va noyob qobiliyatlarga ega jangchilar.",
                IconGlyph = "🔥",
                GradientStart = "#4C0519",
                GradientEnd = "#1C1917",
                AccentColor = "#FB7185",
                ProcessName = "r5apex",
                ExecutablePath = "steam://rungameid/1172470"
            },
            new()
            {
                Id = 6,
                Title = "Point Blank",
                Category = "Otishma",
                Badge = "KLASSIKA",
                BadgeColor = "#6366F1",
                PlayTimeHours = "74 soat",
                Description = "Tezkor koridor otishmalari va klan janglari.",
                IconGlyph = "🔫",
                GradientStart = "#1E1B4B",
                GradientEnd = "#09090B",
                AccentColor = "#818CF8",
                ProcessName = "PointBlank",
                ExecutablePath = "pb.exe"
            },
            new()
            {
                Id = 7,
                Title = "Tom Clancy's Rainbow Six",
                Category = "Otishma",
                Badge = "TAKTIKA",
                BadgeColor = "#0284C7",
                PlayTimeHours = "110 soat",
                Description = "Devorlarni portlatish va maxsus kuchlar operatsiyasi.",
                IconGlyph = "🛡️",
                GradientStart = "#0C4A6E",
                GradientEnd = "#082F49",
                AccentColor = "#38BDF8",
                ProcessName = "RainbowSix",
                ExecutablePath = "uplay:"
            },

            // --- MOBA / STRATEGIYA ---
            new()
            {
                Id = 8,
                Title = "Dota 2",
                Category = "MOBA / Strategiya",
                Badge = "TOP 1",
                BadgeColor = "#DC2626",
                PlayTimeHours = "540 soat",
                Description = "Dunyodagi eng yirik kibersport MOBA strategiyasi.",
                IconGlyph = "⚔️",
                GradientStart = "#450A0A",
                GradientEnd = "#1C1917",
                AccentColor = "#EF4444",
                ProcessName = "dota2",
                ExecutablePath = "steam://rungameid/570"
            },
            new()
            {
                Id = 9,
                Title = "League of Legends",
                Category = "MOBA / Strategiya",
                Badge = "HOT",
                BadgeColor = "#2563EB",
                PlayTimeHours = "310 soat",
                Description = "Riot Games afsonaviy chempionlar jangi.",
                IconGlyph = "🧙",
                GradientStart = "#172554",
                GradientEnd = "#0B0F19",
                AccentColor = "#60A5FA",
                ProcessName = "LeagueClient",
                ExecutablePath = "riotclient:"
            },
            new()
            {
                Id = 10,
                Title = "Warcraft III: Reforged",
                Category = "MOBA / Strategiya",
                Badge = "KLASSIKA",
                BadgeColor = "#D97706",
                PlayTimeHours = "88 soat",
                Description = "Afsonaviy RTS strategiya va maxsus DotA / Custom xaritalar.",
                IconGlyph = "👑",
                GradientStart = "#451A03",
                GradientEnd = "#1C1917",
                AccentColor = "#FBBF24",
                ProcessName = "Warcraft III",
                ExecutablePath = "Warcraft III.exe"
            },
            new()
            {
                Id = 11,
                Title = "StarCraft II",
                Category = "MOBA / Strategiya",
                Badge = "RTS",
                BadgeColor = "#0284C7",
                PlayTimeHours = "62 soat",
                Description = "Koinot miqyosidagi mukammal mikroboshqaruv strategiyasi.",
                IconGlyph = "🚀",
                GradientStart = "#0C4A6E",
                GradientEnd = "#020617",
                AccentColor = "#00F0FF",
                ProcessName = "SC2_x64",
                ExecutablePath = "battlenet:"
            },

            // --- SPORT & POYGA ---
            new()
            {
                Id = 12,
                Title = "EA Sports FC 24",
                Category = "Sport & Poyga",
                Badge = "TOP 1",
                BadgeColor = "#059669",
                PlayTimeHours = "290 soat",
                Description = "Real futbol tajribasi va Ultimate Team turnirlari.",
                IconGlyph = "⚽",
                GradientStart = "#064E3B",
                GradientEnd = "#022C22",
                AccentColor = "#34D399",
                ProcessName = "FC24",
                ExecutablePath = "steam://rungameid/2195250"
            },
            new()
            {
                Id = 13,
                Title = "Forza Horizon 5",
                Category = "Sport & Poyga",
                Badge = "ULTRA",
                BadgeColor = "#EA580C",
                PlayTimeHours = "184 soat",
                Description = "Meksika bo'ylab ochiq dunyo poygalari va yuzlab giperkarlar.",
                IconGlyph = "🏎️",
                GradientStart = "#7C2D12",
                GradientEnd = "#1C1917",
                AccentColor = "#FB923C",
                ProcessName = "ForzaHorizon5",
                ExecutablePath = "steam://rungameid/1551360"
            },
            new()
            {
                Id = 14,
                Title = "Rocket League",
                Category = "Sport & Poyga",
                Badge = "HOT",
                BadgeColor = "#0284C7",
                PlayTimeHours = "118 soat",
                Description = "Reaktiv mashinalarda futbol o'yini.",
                IconGlyph = "🚀",
                GradientStart = "#0369A1",
                GradientEnd = "#0C4A6E",
                AccentColor = "#38BDF8",
                ProcessName = "RocketLeague",
                ExecutablePath = "com.epicgames.launcher://apps/Sugar"
            },
            new()
            {
                Id = 15,
                Title = "Need for Speed: Heat",
                Category = "Sport & Poyga",
                Badge = "TUN",
                BadgeColor = "#C026D3",
                PlayTimeHours = "85 soat",
                Description = "Politsiya ta'qiblari va neonli tungi poygalar.",
                IconGlyph = "🚨",
                GradientStart = "#701A75",
                GradientEnd = "#1E1B4B",
                AccentColor = "#F472B6",
                ProcessName = "NeedForSpeedHeat",
                ExecutablePath = "steam://rungameid/1222680"
            },

            // --- OCHIQ DUNYO & SARGUZASHT ---
            new()
            {
                Id = 16,
                Title = "Grand Theft Auto V",
                Category = "Otishma",
                Badge = "TOP 1",
                BadgeColor = "#16A34A",
                PlayTimeHours = "415 soat",
                Description = "Los Santos shahrida erkinlik, missiyalar va GTA Online.",
                IconGlyph = "🏙️",
                GradientStart = "#14532D",
                GradientEnd = "#052E16",
                AccentColor = "#4ADE80",
                ProcessName = "GTA5",
                ExecutablePath = "steam://rungameid/271590"
            },
            new()
            {
                Id = 17,
                Title = "Cyberpunk 2077",
                Category = "Otishma",
                Badge = "RTX",
                BadgeColor = "#EAB308",
                PlayTimeHours = "95 soat",
                Description = "Night City kelajagi, kiber-implantlar va syujetli ochiq dunyo.",
                IconGlyph = "🌆",
                GradientStart = "#713F12",
                GradientEnd = "#1C1917",
                AccentColor = "#FACC15",
                ProcessName = "Cyberpunk2077",
                ExecutablePath = "steam://rungameid/1091500"
            },
            new()
            {
                Id = 18,
                Title = "Minecraft",
                Category = "MOBA / Strategiya",
                Badge = "KREATIV",
                BadgeColor = "#65A30D",
                PlayTimeHours = "132 soat",
                Description = "Bloklardan iborat cheksiz dunyo, qurilish va sarguzasht.",
                IconGlyph = "⛏️",
                GradientStart = "#365314",
                GradientEnd = "#1A2E05",
                AccentColor = "#A3E635",
                ProcessName = "javaw",
                ExecutablePath = "minecraft:"
            },

            // --- ILOVALAR & BRAUZERLAR ---
            new()
            {
                Id = 19,
                Title = "Google Chrome",
                Category = "Ilovalar & Brauzerlar",
                Badge = "BRAUZER",
                BadgeColor = "#3B82F6",
                PlayTimeHours = "999 soat",
                Description = "Tezkor internet brauzeri, YouTube va ijtimoiy tarmoqlar.",
                IconGlyph = "🌐",
                GradientStart = "#1E3A8A",
                GradientEnd = "#0F172A",
                AccentColor = "#60A5FA",
                ProcessName = "chrome",
                ExecutablePath = "chrome.exe"
            },
            new()
            {
                Id = 20,
                Title = "Discord",
                Category = "Ilovalar & Brauzerlar",
                Badge = "CHAT",
                BadgeColor = "#6366F1",
                PlayTimeHours = "480 soat",
                Description = "Jamoaviy ovozli aloqa va do'stlar bilan chat.",
                IconGlyph = "🎧",
                GradientStart = "#312E81",
                GradientEnd = "#1E1B4B",
                AccentColor = "#818CF8",
                ProcessName = "Discord",
                ExecutablePath = "discord.exe"
            },
            new()
            {
                Id = 21,
                Title = "Telegram Desktop",
                Category = "Ilovalar & Brauzerlar",
                Badge = "ALOQA",
                BadgeColor = "#0284C7",
                PlayTimeHours = "320 soat",
                Description = "Xabarlar, yangiliklar va fayl almashish.",
                IconGlyph = "✈️",
                GradientStart = "#075985",
                GradientEnd = "#0C4A6E",
                AccentColor = "#38BDF8",
                ProcessName = "Telegram",
                ExecutablePath = "Telegram.exe"
            },
            new()
            {
                Id = 22,
                Title = "Steam Client",
                Category = "Ilovalar & Brauzerlar",
                Badge = "MAGAZIN",
                BadgeColor = "#1E293B",
                PlayTimeHours = "850 soat",
                Description = "Shaxsiy o'yinlar kutubxonasi va akkauntingiz.",
                IconGlyph = "🎮",
                GradientStart = "#1E293B",
                GradientEnd = "#020617",
                AccentColor = "#94A3B8",
                ProcessName = "steam",
                ExecutablePath = "steam://open/main"
            }
        };

        foreach (var g in games)
        {
            _allGames.Add(g);
        }
    }

    // =========================================================================
    // 2. SNACK BAR CATALOG INITIALIZATION
    // =========================================================================
    private void InitializeSnackCatalog()
    {
        _snackItems.Clear();

        var snacks = new List<SnackItem>
        {
            new() { Id = 1, Name = "Red Bull (250ml)", Price = 22000, Category = "Energetik", IconEmoji = "⚡" },
            new() { Id = 2, Name = "Flash Up Energy (450ml)", Price = 12000, Category = "Energetik", IconEmoji = "🔋" },
            new() { Id = 3, Name = "Coca-Cola Classic (0.5L)", Price = 9000, Category = "Ichimlik", IconEmoji = "🥤" },
            new() { Id = 4, Name = "Fanta Orange (0.5L)", Price = 9000, Category = "Ichimlik", IconEmoji = "🍊" },
            new() { Id = 5, Name = "Lays Maxx Cheese (Katta)", Price = 16000, Category = "Snack", IconEmoji = "🥔" },
            new() { Id = 6, Name = "Doritos Nacho (100g)", Price = 18000, Category = "Snack", IconEmoji = "🔺" },
            new() { Id = 7, Name = "Hot-Dog Dabl Sosiska", Price = 22000, Category = "FastFood", IconEmoji = "🌭" },
            new() { Id = 8, Name = "Klab Sendvich Tovuqli", Price = 28000, Category = "FastFood", IconEmoji = "🥪" },
            new() { Id = 9, Name = "Kofe Americano (Issiq)", Price = 10000, Category = "Kofe", IconEmoji = "☕" },
            new() { Id = 10, Name = "Suv Nestlé Gazsiz (0.5L)", Price = 4000, Category = "Ichimlik", IconEmoji = "💧" },
        };

        foreach (var s in snacks)
        {
            _snackItems.Add(s);
        }
    }

    // =========================================================================
    // 3. FILTERING & SEARCH
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
        _currentSearchQuery = TxtSearch.Text.Trim().ToLowerInvariant();
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        _filteredGames.Clear();

        var query = _allGames.AsEnumerable();

        // Kategoriya bo'yicha saralash
        if (_currentCategory == "SHOOTER")
            query = query.Where(g => g.Category.Contains("Otishma", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "MOBA")
            query = query.Where(g => g.Category.Contains("MOBA", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "SPORT")
            query = query.Where(g => g.Category.Contains("Sport", StringComparison.OrdinalIgnoreCase));
        else if (_currentCategory == "APPS")
            query = query.Where(g => g.Category.Contains("Ilovalar", StringComparison.OrdinalIgnoreCase));

        // Qidiruv so'zi bo'yicha
        if (!string.IsNullOrWhiteSpace(_currentSearchQuery))
        {
            query = query.Where(g =>
                g.Title.Contains(_currentSearchQuery, StringComparison.OrdinalIgnoreCase) ||
                g.Description.Contains(_currentSearchQuery, StringComparison.OrdinalIgnoreCase) ||
                g.Category.Contains(_currentSearchQuery, StringComparison.OrdinalIgnoreCase));
        }

        foreach (var item in query)
        {
            _filteredGames.Add(item);
        }
    }

    // =========================================================================
    // 4. SESSION LIFECYCLE & LIVE TIME COUNTER
    // =========================================================================
    public void StartMemberSession(string username, double balance, int remainingSeconds, int pcNumber)
    {
        Dispatcher.Invoke(() =>
        {
            _pcNumber = pcNumber;
            _remainingSeconds = remainingSeconds;
            _customerName = username;
            _customerBalance = balance;
            _isMemberSession = true;

            TxtPcNumber.Text = $"PC-{pcNumber:D2}";
            TxtCustomerName.Text = $"👤 {username} (Mijoz)";
            TxtCustomerBalance.Text = $"💳 {balance:N0} UZS";
            TxtCustomerBalance.Visibility = Visibility.Visible;
            TxtTariffName.Text = "MIJOZ HISOBI • QOLGAN VAQT";

            UpdateDisplay();
            _sessionTimer.Start();
            ShowShell();
        });
    }

    public void StartStandardSession(int remainingSeconds, string tariffName, int pcNumber, string customerName = "Mehmon")
    {
        Dispatcher.Invoke(() =>
        {
            _pcNumber = pcNumber;
            _remainingSeconds = remainingSeconds;
            _customerName = customerName;
            _customerBalance = 0;
            _isMemberSession = false;

            TxtPcNumber.Text = $"PC-{pcNumber:D2}";
            TxtCustomerName.Text = $"👤 {customerName}";
            TxtCustomerBalance.Visibility = Visibility.Collapsed;
            TxtTariffName.Text = $"{tariffName.ToUpperInvariant()} • QOLGAN VAQT";

            UpdateDisplay();
            _sessionTimer.Start();
            ShowShell();
        });
    }

    public void UpdateTime(int remainingSeconds)
    {
        Dispatcher.Invoke(() =>
        {
            _remainingSeconds = remainingSeconds;
            UpdateDisplay();
        });
    }

    public void UpdateBalance(double balance)
    {
        Dispatcher.Invoke(() =>
        {
            _customerBalance = balance;
            TxtCustomerBalance.Text = $"💳 {balance:N0} UZS";
        });
    }

    public void StopSession()
    {
        Dispatcher.Invoke(() =>
        {
            _sessionTimer.Stop();
            Hide();
        });
    }

    private void SessionTimer_Tick(object? sender, EventArgs e)
    {
        if (_remainingSeconds > 0)
        {
            _remainingSeconds--;
            UpdateDisplay();

            // Oxirgi 5 daqiqada qizil ogohlantirish
            if (_remainingSeconds <= 300 && _remainingSeconds % 60 == 0)
            {
                ShowToast($"⚠️ Diqqat! Seans tugashiga {Math.Ceiling(_remainingSeconds / 60.0)} daqiqa qoldi.", isWarning: true);
            }
        }
        else
        {
            _sessionTimer.Stop();
            TxtRemainingTime.Text = "00:00:00";
            TxtRemainingTime.Foreground = WpfBrushes.Red;
            ShowToast("⏳ Seans vaqti tugadi! Iltimos, administratorga murojaat qiling.", isWarning: true);
        }
    }

    private void UpdateDisplay()
    {
        TimeSpan t = TimeSpan.FromSeconds(Math.Max(0, _remainingSeconds));
        TxtRemainingTime.Text = $"{(int)t.TotalHours:D2}:{t.Minutes:D2}:{t.Seconds:D2}";

        // Agar 5 daqiqadan kam qolgan bo'lsa qizil rangga kiradi
        if (_remainingSeconds <= 300)
        {
            TxtRemainingTime.Foreground = new SolidColorBrush(WpfColor.FromRgb(244, 63, 94)); // Rose
        }
        else
        {
            TxtRemainingTime.Foreground = new SolidColorBrush(WpfColor.FromRgb(0, 240, 255)); // Neon Cyan
        }
    }

    public void UpdateSessionData(int remainingSeconds, string tariffName, int pcNumber, string customerName = "Mehmon", double? balance = null)
    {
        if (balance.HasValue && balance.Value > 0)
        {
            StartMemberSession(customerName, balance.Value, remainingSeconds, pcNumber);
        }
        else
        {
            StartStandardSession(remainingSeconds, tariffName, pcNumber, customerName);
        }
    }

    public void ShowShell()
    {
        WindowState = WindowState.Maximized;
        Topmost = false; // So games can run above it
        Show();
        Activate();
        Focus();
    }

    // =========================================================================
    // 5. GAME LAUNCH & SHELL BACKGROUND RETREAT ENGINE
    // =========================================================================
    private void BtnPlayGame_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is GameItem game)
        {
            LaunchGame(game);
        }
    }

    private void LaunchGame(GameItem game)
    {
        try
        {
            ShowToast($"🚀 {game.Title} ishga tushirilmoqda. Launcher orqa fonga chekinmoqda...", isWarning: false);
            game.IsRunning = true;

            // O'yinni ishga tushirish (agar real fayl yoki steam protokoli bo'lsa)
            Process? startedProcess = null;
            if (!string.IsNullOrWhiteSpace(game.ExecutablePath))
            {
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = game.ExecutablePath,
                        UseShellExecute = true
                    };
                    startedProcess = Process.Start(psi);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[ShellWindow] Boshlash xatosi ({game.Title}): {ex.Message}");
                }
            }

            // Launcher'ni orqa fonga minimal resurs bilan chekintirish
            WindowState = WindowState.Minimized;

            // O'yin tugashini kuzatuvchi monitoring
            Task.Run(async () =>
            {
                if (startedProcess != null)
                {
                    try
                    {
                        await startedProcess.WaitForExitAsync();
                    }
                    catch { /* ignore */ }
                }
                else if (!string.IsNullOrWhiteSpace(game.ProcessName))
                {
                    // Jarayon nomini 15 soniya davomida kutish
                    Process? target = null;
                    for (int i = 0; i < 15; i++)
                    {
                        await Task.Delay(1000);
                        var procs = Process.GetProcessesByName(game.ProcessName);
                        if (procs.Length > 0)
                        {
                            target = procs[0];
                            break;
                        }
                    }

                    if (target != null)
                    {
                        try { await target.WaitForExitAsync(); } catch { }
                    }
                    else
                    {
                        // Mock demo rejimi: foydalanuvchi sinov qilayotgan bo'lsa 8 soniyadan keyin qaytadi
                        await Task.Delay(8000);
                    }
                }
                else
                {
                    await Task.Delay(6000);
                }

                // O'yin tugagach darhol Launcher'ni oldinga qaytarish
                Dispatcher.Invoke(() =>
                {
                    game.IsRunning = false;
                    WindowState = WindowState.Maximized;
                    Show();
                    Activate();
                    Topmost = true;
                    Topmost = false;
                    ShowToast($"🎮 {game.Title} sessiyasi yakunlandi. Xush kelibsiz!", isWarning: false);
                });
            });
        }
        catch (Exception ex)
        {
            ShowToast($"Xatolik: {ex.Message}", isWarning: true);
            game.IsRunning = false;
        }
    }

    // =========================================================================
    // 6. TOP BAR ACTIONS: BAR, ADMIN, VOLUME, LOGOUT
    // =========================================================================
    private void BtnOpenBar_Click(object sender, RoutedEventArgs e)
    {
        var barWindow = new BarShopWindow(
            pcNumber: _pcNumber,
            memberUsername: _customerName,
            memberBalance: _customerBalance,
            isMember: _isMemberSession)
        {
            Owner = this
        };

        barWindow.OnOrderPlaced += (summary, total, paymentOption, note) =>
        {
            ShowToast($"🛒 Buyurtmangiz qabul qilindi ({total:N0} UZS)! Xodim tez orada olib keladi.", isWarning: false);
            OnBarOrderSubmitted?.Invoke(summary, total);
        };

        barWindow.ShowDialog();
    }

    private void BtnCloseBarModal_Click(object sender, RoutedEventArgs e)
    {
        BarModalOverlay.Visibility = Visibility.Collapsed;
    }

    private void BtnPlusSnack_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SnackItem snack)
        {
            snack.OrderQuantity++;
            UpdateBarTotalSum();
        }
    }

    private void BtnMinusSnack_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SnackItem snack)
        {
            if (snack.OrderQuantity > 0)
            {
                snack.OrderQuantity--;
                UpdateBarTotalSum();
            }
        }
    }

    private void UpdateBarTotalSum()
    {
        double total = _snackItems.Sum(s => s.TotalCost);
        TxtBarTotalSum.Text = $"{total:N0} UZS";
    }

    private void BtnSubmitBarOrder_Click(object sender, RoutedEventArgs e)
    {
        var ordered = _snackItems.Where(s => s.OrderQuantity > 0).ToList();
        if (!ordered.Any())
        {
            ShowToast("Iltimos, avval mahsulot tanlang!", isWarning: true);
            return;
        }

        double total = ordered.Sum(s => s.TotalCost);
        string summary = string.Join(", ", ordered.Select(s => $"{s.Name} x{s.OrderQuantity}"));

        // Tozalash
        foreach (var item in ordered) item.OrderQuantity = 0;
        UpdateBarTotalSum();
        BarModalOverlay.Visibility = Visibility.Collapsed;

        OnBarOrderSubmitted?.Invoke(summary, total);
        ShowToast($"🛒 Buyurtmangiz qabul qilindi ({total:N0} UZS). Xodim tez orada olib keladi!", isWarning: false);
    }

    private void BtnCallAdmin_Click(object sender, RoutedEventArgs e)
    {
        OnAdminCallRequested?.Invoke($"PC-{_pcNumber:D2}");
        ShowToast("🔔 Administrator chaqirildi! Xodim yaqin orada kompyuteringiz oldiga keladi.", isWarning: false);
    }

    private void BtnVolume_Click(object sender, RoutedEventArgs e)
    {
        VolumeModalOverlay.Visibility = VolumeModalOverlay.Visibility == Visibility.Visible
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void VolumeOverlay_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource == VolumeModalOverlay)
        {
            VolumeModalOverlay.Visibility = Visibility.Collapsed;
        }
    }

    private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (TxtVolumePercent != null)
        {
            TxtVolumePercent.Text = $"{(int)e.NewValue}%";
        }
    }

    private void BtnVolumePreset_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tagStr && int.TryParse(tagStr, out int val))
        {
            VolumeSlider.Value = val;

            if (val == 0)
            {
                // Mute toggle
                keybd_event(VK_VOLUME_MUTE, 0, 0, 0);
                keybd_event(VK_VOLUME_MUTE, 0, KEYEVENTF_KEYUP, 0);
                ShowToast("🔇 Ovoz o'chirildi (Muted)", isWarning: false);
            }
            else
            {
                // Windows native volume trigger
                keybd_event(VK_VOLUME_UP, 0, 0, 0);
                keybd_event(VK_VOLUME_UP, 0, KEYEVENTF_KEYUP, 0);
                ShowToast($"🔊 Ovoz darajasi: {val}%", isWarning: false);
            }
        }
    }

    private void BtnEndSession_Click(object sender, RoutedEventArgs e)
    {
        var result = WpfMessageBox.Show(
            "Seansni yakunlab, tizimdan chiqishni xohlaysizmi?",
            "Seansni yakunlash",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (result == MessageBoxResult.Yes)
        {
            StopSession();
            OnLogoutRequested?.Invoke();
        }
    }

    // =========================================================================
    // 7. TOAST NOTIFICATION ENGINE
    // =========================================================================
    public void ShowUpdatePendingNotice(string version)
    {
        ShowToast($"🚀 Yangilanish v{version} yuklandi, seans tugagach o'rnatiladi.", isWarning: false);
    }

    public void ShowToast(string message, bool isWarning = false)
    {
        Dispatcher.Invoke(() =>
        {
            ToastMessage.Text = message;
            ToastIcon.Text = isWarning ? "⚠️ " : "🔔 ";
            ToastBanner.Background = isWarning
                ? new SolidColorBrush(WpfColor.FromRgb(225, 29, 72)) // Crimson
                : new SolidColorBrush(WpfColor.FromRgb(2, 132, 199)); // Cyan Blue
            ToastBanner.BorderBrush = isWarning
                ? new SolidColorBrush(WpfColor.FromRgb(251, 113, 133))
                : new SolidColorBrush(WpfColor.FromRgb(56, 189, 248));

            ToastBanner.Visibility = Visibility.Visible;
            _toastTimer.Stop();
            _toastTimer.Start();
        });
    }

    protected override void OnClosed(EventArgs e)
    {
        _sessionTimer.Stop();
        _toastTimer.Stop();
        base.OnClosed(e);
    }
}
