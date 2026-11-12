using System;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace Softech.Networking;

public static class ServerAddress
{
    public static string Normalize(string input)
    {
        string value = (input ?? "").Trim();
        if (Regex.IsMatch(value, @"^\d{1,3}(\.\d{1,3}){3}$") &&
            IPAddress.TryParse(value, out var ip) && ip.AddressFamily == AddressFamily.InterNetwork)
            return $"ws://{ip}:5000/ws";
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
            (uri.Scheme == "ws" || uri.Scheme == "wss") && !string.IsNullOrWhiteSpace(uri.Host) &&
            uri.AbsolutePath == "/ws" && string.IsNullOrEmpty(uri.UserInfo) &&
            string.IsNullOrEmpty(uri.Fragment) && string.IsNullOrEmpty(uri.Query) && !value.Contains('\\'))
            return value;
        throw new ArgumentException("Server IP manzilini kiriting, masalan: 192.168.199.10. To‘liq ws:// yoki wss:// manzil ham mumkin.");
    }

    public static string Display(string value)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "ws" &&
            uri.Port == 5000 && uri.AbsolutePath == "/ws" && string.IsNullOrEmpty(uri.UserInfo) &&
            string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
            IPAddress.TryParse(uri.Host, out var ip) && ip.AddressFamily == AddressFamily.InterNetwork)
            return uri.Host;
        return value;
    }
}
