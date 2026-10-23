using System;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace NetCafeClient;

// ============================================================
// Config Model (Case-insensitive, supports string "PC-01" & number 1)
// ============================================================
public class ConfigModel
{
    private string _pcNumberStr = "PC-01";

    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = "ws://localhost:5000/ws";

    [JsonPropertyName("pcNumber")]
    public object? RawPcNumber
    {
        get => _pcNumberStr;
        set => _pcNumberStr = NormalizePcNumber(value);
    }

    [JsonPropertyName("workstationName")]
    public string? WorkstationName
    {
        get => _pcNumberStr;
        set
        {
            if (!string.IsNullOrWhiteSpace(value))
                _pcNumberStr = NormalizePcNumber(value);
        }
    }

    [JsonIgnore]
    public string PcNumber => _pcNumberStr;

    [JsonPropertyName("heartbeatIntervalSeconds")]
    public int HeartbeatIntervalSeconds { get; set; } = 5;

    public static string NormalizePcNumber(object? val)
    {
        if (val is JsonElement el)
        {
            if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int n))
                return $"PC-{n:D2}";
            string str = el.GetString() ?? "PC-01";
            return string.IsNullOrWhiteSpace(str) ? "PC-01" : str.Trim();
        }
        if (val != null)
        {
            string s = val.ToString() ?? "PC-01";
            if (int.TryParse(s, out int n))
                return $"PC-{n:D2}";
            return string.IsNullOrWhiteSpace(s) ? "PC-01" : s.Trim();
        }
        return "PC-01";
    }

    [JsonIgnore]
    public int NumericPcNumber
    {
        get
        {
            var match = System.Text.RegularExpressions.Regex.Match(_pcNumberStr, @"\d+");
            return match.Success && int.TryParse(match.Value, out int n) ? n : 1;
        }
    }
}

// ============================================================
// WebSocket Client Service  — "Temir Qulf" Communication Core
// ============================================================
public class WebSocketClientService
{
    private readonly ConfigModel             _config;
    private          ClientWebSocket?        _client;
    private          CancellationTokenSource _cts = new();

    // ---- Events ----
    public event Action?                                       OnLockScreen;
    public event Action<string, int, string, string, double?>? OnStartSession;       // sessionId, remainingSecs, tariffName, customerName, clientBalance?
    public event Action<int>?                                  OnUpdateTime;         // remainingSeconds
    public event Action<string>?                               OnStopSession;        // reason
    public event Action<bool>?                                 OnConnectionStatusChanged; // isConnected
    public event Action<string, double, int, string>?          OnMemberLoginSuccess; // sessionId, balance, remainingSecs, username
    public event Action<string>?                               OnMemberLoginFailed;  // error
    public event Action<double>?                               OnBalanceUpdate;      // balance
    public event Action<string>?                               OnPowerCommand;       // SHUTDOWN | REBOOT | LOCK | UNLOCK
    public event Action<string, double, string, string>?       OnPcConfigReceived;   // zoneName, pricePerHour, formattedRate, qrToken
    public event Action<string, string>?                       OnEmergencyLockdown;  // reason, message (SaaS Remote Kill-Switch)

    // ---- Properties ----
    public bool   IsConnected     => _client?.State == WebSocketState.Open;
    public int    PcNumber        => _config.NumericPcNumber;
    public string PcNumberString  => _config.PcNumber;
    public string WorkstationName => _config.PcNumber;
    public string ServerUrl       => _config.ServerUrl;

    public WebSocketClientService()
    {
        _config = LoadConfig();
    }

    public void UpdateConfig(string pcNumber, string serverUrl)
    {
        _config.RawPcNumber = pcNumber;
        _config.ServerUrl = serverUrl;
        SaveConfigFile(_config);
        ReconnectNow();
    }

    public void UpdateConfig(int pcNumber, string serverUrl, string? workstationName = null)
    {
        _config.RawPcNumber = workstationName ?? $"PC-{pcNumber:D2}";
        _config.ServerUrl = serverUrl;
        SaveConfigFile(_config);
        ReconnectNow();
    }

    public void ReconnectNow()
    {
        try
        {
            _client?.Abort();
            _client?.Dispose();
        }
        catch { }
    }

    private static string GetConfigFilePath()
    {
        // STRICT REQUIREMENT: AppContext.BaseDirectory instead of Directory.GetCurrentDirectory()
        return Path.Combine(AppContext.BaseDirectory, "config.json");
    }

    private static void SaveConfigFile(ConfigModel config)
    {
        try
        {
            string path = GetConfigFilePath();
            var payload = new
            {
                serverUrl = config.ServerUrl,
                pcNumber = config.PcNumber,
                heartbeatIntervalSeconds = config.HeartbeatIntervalSeconds
            };
            var options = new JsonSerializerOptions { WriteIndented = true };
            File.WriteAllText(path, JsonSerializer.Serialize(payload, options));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Config] Saqlashda xato: {ex.Message}");
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    public void Start() => Task.Run(ConnectionLoop);

    public void Stop()
    {
        try { _cts.Cancel(); } catch { /* ignore */ }
    }

    // -----------------------------------------------------------------------
    // Config Loader (AppContext.BaseDirectory)
    // -----------------------------------------------------------------------

    private ConfigModel LoadConfig()
    {
        string path = GetConfigFilePath();
        try
        {
            if (File.Exists(path))
            {
                string json = File.ReadAllText(path);
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var loaded = JsonSerializer.Deserialize<ConfigModel>(json, options);
                if (loaded != null)
                {
                    return loaded;
                }
            }
        }
        catch { /* fallback to defaults */ }

        // If config file does not exist, auto-create it with defaults on first launch
        var def = new ConfigModel
        {
            ServerUrl = "ws://localhost:5000/ws",
            RawPcNumber = "PC-01",
            HeartbeatIntervalSeconds = 5
        };

        SaveConfigFile(def);
        return def;
    }

    // -----------------------------------------------------------------------
    // Connection Loop (auto-reconnect with exponential back-off 2-5s)
    // -----------------------------------------------------------------------

    private async Task ConnectionLoop()
    {
        int retryDelay = 2000;

        while (!_cts.IsCancellationRequested)
        {
            try
            {
                _client = new ClientWebSocket();
                _client.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);

                await _client.ConnectAsync(new Uri(_config.ServerUrl), _cts.Token);

                // Dispatch connection state
                System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                {
                    OnConnectionStatusChanged?.Invoke(true);
                });

                retryDelay = 2000; // reset back-off on success

                // BUG 1: Immediately send handshake { "type": "CLIENT_HELLO", "pcNumber": "PC-01", "ip": "CLIENT_LOCAL_IP" }
                await SendHandshakeAsync();

                var heartbeatTask = Task.Run(HeartbeatLoop, _cts.Token);
                await ReceiveLoopAsync();
                await heartbeatTask;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WS] Xato: {ex.Message}");
                System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                {
                    OnConnectionStatusChanged?.Invoke(false);
                });
            }
            finally
            {
                System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                {
                    OnConnectionStatusChanged?.Invoke(false);
                });
                _client?.Dispose();
                _client = null;
            }

            try
            {
                await Task.Delay(retryDelay, _cts.Token);
                retryDelay = Math.Min(retryDelay + 500, 5000);
            }
            catch (OperationCanceledException) { break; }
        }
    }

    // -----------------------------------------------------------------------
    // Handshake (BUG 1: CLIENT_HELLO)
    // -----------------------------------------------------------------------

    private async Task SendHandshakeAsync()
    {
        string localIp = GetLocalIpAddress();
        var helloMsg = new
        {
            type = "CLIENT_HELLO",
            @event = "CLIENT_HANDSHAKE",
            pcNumber = _config.PcNumber,
            ip = localIp,
            payload = new
            {
                pcNumber = _config.PcNumber,
                ipAddress = localIp,
                macAddress = GetMacAddress(),
                agentVersion = "2.0.0",
                osInfo = Environment.OSVersion.VersionString
            },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        await SendRawAsync(helloMsg);
    }

    // -----------------------------------------------------------------------
    // Heartbeat Loop (5s interval)
    // -----------------------------------------------------------------------

    private async Task HeartbeatLoop()
    {
        while (_client != null && _client.State == WebSocketState.Open && !_cts.IsCancellationRequested)
        {
            try
            {
                var hb = new
                {
                    type = "HEARTBEAT_PING",
                    @event = "HEARTBEAT_PING",
                    pcNumber = _config.PcNumber,
                    payload = new
                    {
                        pcNumber = _config.PcNumber,
                        uptimeSeconds = Environment.TickCount64 / 1000
                    },
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };

                await SendRawAsync(hb);
                await Task.Delay(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds), _cts.Token);
            }
            catch { break; }
        }
    }

    // -----------------------------------------------------------------------
    // Receive Loop
    // -----------------------------------------------------------------------

    private async Task ReceiveLoopAsync()
    {
        var buffer     = new byte[16384];
        var msgBuilder = new StringBuilder();

        while (_client != null && _client.State == WebSocketState.Open && !_cts.IsCancellationRequested)
        {
            try
            {
                WebSocketReceiveResult result;
                msgBuilder.Clear();

                do
                {
                    result = await _client.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    msgBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                }
                while (!result.EndOfMessage);

                ProcessServerMessage(msgBuilder.ToString());
            }
            catch (OperationCanceledException) { return; }
            catch { return; }
        }
    }

    // -----------------------------------------------------------------------
    // Message Processor (BUG 1, BUG 2, BUG 3)
    // -----------------------------------------------------------------------

    private void ProcessServerMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            // Extract message type (supports "type" or "event")
            string eventName = "";
            if (root.TryGetProperty("type", out var typeProp))
                eventName = typeProp.GetString() ?? "";
            else if (root.TryGetProperty("event", out var evtProp))
                eventName = evtProp.GetString() ?? "";

            if (string.IsNullOrEmpty(eventName)) return;

            // Support nested payload or flat root
            JsonElement data = root.TryGetProperty("payload", out var p) && p.ValueKind == JsonValueKind.Object ? p : root;

            switch (eventName.ToUpperInvariant())
            {
                // ---- SaaS Remote Kill-Switch & Anti-Piracy Lockdown ----
                case "EMERGENCY_LOCKDOWN":
                case "LOCK_WORKSTATION":
                case "LOCKED_BY_ADMIN":
                case "FORCE_CLIENT_LOCKDOWN":
                {
                    string reason = data.TryGetProperty("reason", out var r) ? (r.GetString() ?? "PAYMENT_OVERDUE") : "PAYMENT_OVERDUE";
                    string msg = data.TryGetProperty("message", out var m) ? (m.GetString() ?? "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16") : "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16";

                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnEmergencyLockdown?.Invoke(reason, msg);
                    });
                    break;
                }

                // ---- Ekran Qulflash ----
                case "LOCK_SCREEN":
                case "LOCK":
                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnLockScreen?.Invoke();
                    });
                    break;

                // ---- BUG 2: Seans Boshlash ----
                case "START_SESSION":
                {
                    string sessionId = "";
                    if (data.TryGetProperty("sessionId", out var s))
                    {
                        sessionId = s.ValueKind == JsonValueKind.Number ? s.GetInt64().ToString() : (s.GetString() ?? "");
                    }

                    int remaining = 0;
                    if (data.TryGetProperty("remainingSeconds", out var r) && r.ValueKind == JsonValueKind.Number)
                    {
                        remaining = r.GetInt32();
                    }
                    else if (data.TryGetProperty("durationMinutes", out var dm) && dm.ValueKind == JsonValueKind.Number)
                    {
                        remaining = dm.GetInt32() * 60;
                    }

                    string tariff = "Standart";
                    if (data.TryGetProperty("tariffName", out var t)) tariff = t.GetString() ?? "Standart";
                    else if (data.TryGetProperty("zoneName", out var zn)) tariff = zn.GetString() ?? "Standart";

                    string customer = data.TryGetProperty("customerName", out var c) ? (c.GetString() ?? "Mijoz") : "Mijoz";
                    double? clientBal = data.TryGetProperty("clientBalance", out var cb) && cb.ValueKind == JsonValueKind.Number ? cb.GetDouble() : null;

                    // UI transition strictly inside Dispatcher.Invoke
                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnStartSession?.Invoke(sessionId, remaining, tariff, customer, clientBal);
                    });
                    break;
                }

                // ---- Member Login Muvaffaqiyatli ----
                case "MEMBER_LOGIN_SUCCESS":
                case "CLIENT_LOGIN_SUCCESS":
                {
                    string sessionId = "";
                    if (data.TryGetProperty("sessionId", out var s))
                        sessionId = s.ValueKind == JsonValueKind.Number ? s.GetInt64().ToString() : (s.GetString() ?? "");

                    string username = data.TryGetProperty("username", out var u) ? (u.GetString() ?? "") : "";
                    double balance = data.TryGetProperty("balance", out var b) && b.ValueKind == JsonValueKind.Number ? b.GetDouble() : 0.0;
                    int remaining = 0;
                    if (data.TryGetProperty("remainingSeconds", out var r) && r.ValueKind == JsonValueKind.Number)
                        remaining = r.GetInt32();
                    else if (data.TryGetProperty("totalMinutes", out var tm) && tm.ValueKind == JsonValueKind.Number)
                        remaining = tm.GetInt32() * 60;

                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnMemberLoginSuccess?.Invoke(sessionId, balance, remaining, username);
                    });
                    break;
                }

                // ---- Member Login Muvaffaqiyatsiz ----
                case "MEMBER_LOGIN_FAILED":
                case "CLIENT_LOGIN_FAILED":
                {
                    string error = data.TryGetProperty("error", out var err) ? (err.GetString() ?? "Kirishda xatolik yuz berdi") : "Kirishda xatolik yuz berdi";
                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnMemberLoginFailed?.Invoke(error);
                    });
                    break;
                }

                // ---- Balans Yangilanishi ----
                case "CLIENT_BALANCE_UPDATE":
                {
                    if (data.TryGetProperty("balance", out var b) && b.ValueKind == JsonValueKind.Number)
                    {
                        double bal = b.GetDouble();
                        System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                        {
                            OnBalanceUpdate?.Invoke(bal);
                        });
                    }
                    break;
                }

                // ---- Vaqt Yangilanishi ----
                case "UPDATE_REMAINING_TIME":
                case "UPDATE_TIME":
                {
                    if (data.TryGetProperty("remainingSeconds", out var r) && r.ValueKind == JsonValueKind.Number)
                    {
                        int secs = r.GetInt32();
                        System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                        {
                            OnUpdateTime?.Invoke(secs);
                        });
                    }
                    break;
                }

                // ---- Seans Tugash ----
                case "STOP_SESSION":
                {
                    string reason = data.TryGetProperty("reason", out var r) ? (r.GetString() ?? "Tugadi") : "Tugadi";
                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnStopSession?.Invoke(reason);
                    });
                    break;
                }

                // ---- Masofaviy Buyruqlar ----
                case "REMOTE_COMMAND":
                case "POWER_COMMAND":
                {
                    string cmd = "";
                    if      (data.TryGetProperty("command", out var c)) cmd = c.GetString() ?? "";
                    else if (data.TryGetProperty("action",  out var a)) cmd = a.GetString() ?? "";

                    if (!string.IsNullOrEmpty(cmd))
                    {
                        System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                        {
                            OnPowerCommand?.Invoke(cmd.ToUpperInvariant());
                        });
                    }
                    break;
                }

                // ---- BUG 3: Dynamic Pricing CONFIG_UPDATE ----
                case "CONFIG_UPDATE":
                case "PC_CONFIG":
                case "ZONE_INFO_UPDATE":
                {
                    string zone = data.TryGetProperty("zoneName", out var zn) ? (zn.GetString() ?? "STANDARD") : "STANDARD";
                    double price = data.TryGetProperty("pricePerHour", out var pph) && pph.ValueKind == JsonValueKind.Number ? pph.GetDouble() : 10000;
                    string formatted = data.TryGetProperty("rateFormatted", out var rf) ? (rf.GetString() ?? $"{price:N0} UZS / soat".Replace(",", " ")) : $"{price:N0} UZS / soat".Replace(",", " ");
                    string qr = data.TryGetProperty("qrToken", out var qt) ? (qt.GetString() ?? "") : "";

                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnPcConfigReceived?.Invoke(zone, price, formatted, qr);
                    });
                    break;
                }

                // ---- Handshake ACK ----
                case "HANDSHAKE_ACK":
                {
                    string zone = data.TryGetProperty("zoneName", out var zn) ? (zn.GetString() ?? "STANDARD") : "STANDARD";
                    double price = data.TryGetProperty("pricePerHour", out var pph) && pph.ValueKind == JsonValueKind.Number ? pph.GetDouble() : 10000;
                    string formatted = data.TryGetProperty("rateFormatted", out var rf) ? (rf.GetString() ?? $"{price:N0} UZS / soat".Replace(",", " ")) : $"{price:N0} UZS / soat".Replace(",", " ");
                    string qr = data.TryGetProperty("qrToken", out var qt) ? (qt.GetString() ?? "") : "";

                    System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                    {
                        OnPcConfigReceived?.Invoke(zone, price, formatted, qr);
                    });

                    if (data.TryGetProperty("activeSession", out var act) && act.ValueKind == JsonValueKind.Object)
                    {
                        string sId = "";
                        if (act.TryGetProperty("sessionId", out var asId))
                            sId = asId.ValueKind == JsonValueKind.Number ? asId.GetInt64().ToString() : (asId.GetString() ?? "");

                        int rem = act.TryGetProperty("remainingSeconds", out var ar) && ar.ValueKind == JsonValueKind.Number ? ar.GetInt32() : 0;
                        string tr = act.TryGetProperty("tariffName", out var at) ? (at.GetString() ?? "Faol Seans") : "Faol Seans";
                        string cust = act.TryGetProperty("customerName", out var acn) ? (acn.GetString() ?? "Mehmon") : "Mehmon";
                        double? bal = act.TryGetProperty("balance", out var abl) && abl.ValueKind == JsonValueKind.Number ? abl.GetDouble() : null;

                        System.Windows.Application.Current?.Dispatcher.Invoke(() =>
                        {
                            OnStartSession?.Invoke(sId, rem, tr, cust, bal);
                        });
                    }
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WS] ProcessMessage xato: {ex.Message}");
        }
    }

    // -----------------------------------------------------------------------
    // Outgoing Messages
    // -----------------------------------------------------------------------

    public async Task SendMemberLoginAsync(string username, string password)
    {
        var msg = new
        {
            type = "CLIENT_MEMBER_LOGIN",
            @event = "CLIENT_MEMBER_LOGIN",
            pcNumber = _config.PcNumber,
            username,
            password,
            payload = new { pcNumber = _config.PcNumber, username, password },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        await SendRawAsync(msg);
    }

    public async Task SendLogoutAsync()
    {
        var msg = new
        {
            type = "CLIENT_MEMBER_LOGOUT",
            @event = "CLIENT_MEMBER_LOGOUT",
            pcNumber = _config.PcNumber,
            payload = new { pcNumber = _config.PcNumber },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        await SendRawAsync(msg);
    }

    public async Task SendQrRefreshRequestAsync()
    {
        var msg = new
        {
            type = "CLIENT_QR_REFRESH",
            @event = "CLIENT_QR_REFRESH",
            pcNumber = _config.PcNumber,
            payload = new { pcNumber = _config.PcNumber },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        await SendRawAsync(msg);
    }

    public async Task SendBarOrderAsync(string pcNumber, object items, double totalAmount, string paymentMethod, string? note = null)
    {
        var msg = new
        {
            type = "CLIENT_BAR_ORDER",
            @event = "CLIENT_BAR_ORDER",
            pcNumber = _config.PcNumber,
            workstationName = _config.PcNumber,
            payload = new
            {
                pcNumber = _config.PcNumber,
                workstationName = _config.PcNumber,
                items,
                totalAmount,
                paymentMethod,
                note
            },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        await SendRawAsync(msg);
    }

    public async Task SendRawAsync(object data)
    {
        if (_client == null || _client.State != WebSocketState.Open) return;

        try
        {
            string json = JsonSerializer.Serialize(data);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            await _client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WS] Send xato: {ex.Message}");
        }
    }

    public static string GetLocalIpAddress()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0);
            socket.Connect("8.8.8.8", 65530);
            if (socket.LocalEndPoint is IPEndPoint endPoint)
                return endPoint.Address.ToString();
        }
        catch { }

        try
        {
            var host = Dns.GetHostEntry(Dns.GetHostName());
            foreach (var ip in host.AddressList)
            {
                if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                    return ip.ToString();
            }
        }
        catch { }

        return "127.0.0.1";
    }

    private static string GetMacAddress()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus == OperationalStatus.Up &&
                    nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                {
                    return nic.GetPhysicalAddress().ToString();
                }
            }
        }
        catch { }
        return "00:00:00:00:00:00";
    }
}
