using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace NetCafeClient.Views;
public partial class AccountSettingsWindow : Window
{
    private readonly Func<string, string?, string, Task<JsonElement>> _update;
    public event Action<string>? Saved;
    public AccountSettingsWindow(string username, Func<string, string?, string, Task<JsonElement>> update)
    {
        InitializeComponent(); Login.Text = username; _update = update;
        Closed += (_, _) => { Current.Clear(); Password.Clear(); Confirm.Clear(); };
    }
    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (Current.Password.Length == 0) { Status.Text = "Amaldagi parolni kiriting."; return; }
        if (Password.Password != Confirm.Password) { Status.Text = "Yangi parollar bir xil emas."; return; }
        Save.IsEnabled = false; Status.Text = "Saqlanmoqda...";
        try
        {
            var result = await _update(Login.Text.Trim(), Password.Password.Length == 0 ? null : Password.Password, Current.Password);
            if (!result.GetProperty("success").GetBoolean()) { Status.Text = result.GetProperty("error").GetString(); return; }
            var username = result.GetProperty("username").GetString()!;
            Login.Text = username; Saved?.Invoke(username);
            Current.Clear(); Password.Clear(); Confirm.Clear();
            Status.Text = "Saqlandi. Keyingi kirishda yangi login va paroldan foydalaning.";
        }
        catch (TimeoutException) { Status.Text = "Javob kelmadi. Saqlangan bo‘lishi mumkin; administrator orqali tekshiring."; }
        catch (Exception) { Status.Text = "Server bilan aloqa yo‘q. Qayta ulanishni kuting."; }
        finally { Save.IsEnabled = true; }
    }
}
