using System;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Softech.Security;

public static class EmergencyPassword
{
    private const int Iterations = 600_000;

    public static JsonObject Create(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8 || password.Length > 256)
            throw new ArgumentException("Favqulodda chiqish paroli 8–256 belgidan iborat bo‘lsin.");
        byte[] salt = RandomNumberGenerator.GetBytes(32);
        byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return new JsonObject { ["algorithm"] = "pbkdf2-sha256", ["iterations"] = Iterations,
            ["salt"] = Convert.ToBase64String(salt), ["hash"] = Convert.ToBase64String(hash) };
    }

    public static bool Verify(JsonNode? verifier, string password)
    {
        try
        {
            if (password.Length == 0 || password.Length > 256 || verifier?["algorithm"]?.GetValue<string>() != "pbkdf2-sha256") return false;
            int iterations = verifier["iterations"]!.GetValue<int>();
            if (iterations < Iterations || iterations > 1_000_000) return false;
            byte[] salt = Convert.FromBase64String(verifier["salt"]!.GetValue<string>());
            byte[] expected = Convert.FromBase64String(verifier["hash"]!.GetValue<string>());
            if (salt.Length != 32 || expected.Length != 32) return false;
            byte[] actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; } // Missing or damaged configuration never grants access.
    }

    public static string Configure(string configuration, string currentPassword, string newPassword, string confirmation)
    {
        var config = JsonNode.Parse(configuration) as JsonObject ?? throw new ArgumentException("config.json yaroqsiz.");
        if (config["emergencyAccess"] != null && !Verify(config["emergencyAccess"], currentPassword))
            throw new ArgumentException("Mavjud favqulodda chiqish paroli noto‘g‘ri.");
        if (newPassword.Length == 0 && config["emergencyAccess"] != null)
        {
            if (confirmation.Length != 0) throw new ArgumentException("Yangi parolni ham kiriting.");
            return configuration;
        }
        if (newPassword != confirmation) throw new ArgumentException("Yangi parollar bir xil emas.");
        config["emergencyAccess"] = Create(newPassword);
        return config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    }
}
