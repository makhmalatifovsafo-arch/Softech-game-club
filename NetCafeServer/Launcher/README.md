# Softech Game Club — Standalone Cashier Cockpit Desktop App

**Softech Cockpit** — bu o'yin klubi kassiri va ma'muri uchun mo'ljallangan, zamonaviy Windows dasturi (Spotify va Discord kabi mustaqil arxitekturada). 

Ushbu ilovaning asosiy maqsadi:
1. **0% CMD/Terminal ko'rinishi (`OutputType: WinExe`)**: Qora konsol oynalari umuman chiqmaydi.
2. **Fon rejimida Node.js boshqaruvi (`NodeProcessManager.cs`)**: NetCafeServer backend jarayonini avtomatik ishga tushiradi, sog'lig'ini (`/api/health`) tekshiradi va ilova yopilganda RAM dan butunlay tozalaydi.
3. **Microsoft WebView2 Kiosk Engine**: Brauzer menyulari (Inspect, Reload), URL havolalari va masshtab o'zgarishlari to'liq bloklangan toza interfeys.
4. **Single-Instance Mutex Guard**: Dastur bir vaqtning o'zida bir necha marta ochilmaydi; qayta bosilganda mavjud oyna avtomatik tarzda oldinga (`SetForegroundWindow`) chiqadi.

---

## 📁 Loyiha Tuzilmasi

```
NetCafeServer/
├── Launcher/
│   ├── SoftechCockpit.csproj      # .NET 8 WPF loyiha konfiguratsiyasi
│   ├── App.xaml                   # Ilova resurslari
│   ├── App.xaml.cs                # Single-Instance Mutex Guard & Win32 Window Focus
│   ├── MainWindow.xaml            # Custom dark titlebar & WebView2 konteyneri
│   ├── MainWindow.xaml.cs         # WebView2 sozlamalari & hodisalar
│   ├── NodeProcessManager.cs      # Headless Node.js lifecycle boshqaruvchisi
│   ├── app.ico                    # Yuqori aniqlikdagi ilova belgisi
│   └── InnoSetup_Cockpit.iss      # Inno Setup o'rnatuvchi yaratish skripti
├── runtime/
│   └── node.exe                   # Portativ Node.js dvigateli
├── src/
│   └── server.js                  # Asosiy NetCafeServer backend kirish nuqtasi
└── public/
    └── index.html                 # Kassir boshqaruv ekrani
```

---

## ⚙️ Texnik Xususiyatlar

### 1. Headless Process StartInfo
Node.js jarayoni quyidagi xavfsiz parametrlar bilan ishga tushadi:
```csharp
var startInfo = new ProcessStartInfo {
    FileName = nodePath,
    Arguments = "src/server.js",
    WorkingDirectory = serverDirectory,
    CreateNoWindow = true,
    UseShellExecute = false,
    WindowStyle = ProcessWindowStyle.Hidden,
    RedirectStandardOutput = false,
    RedirectStandardError = false
};
```

### 2. WebView2 Xavfsizlik Sozlamalari
```csharp
var settings = CockpitWebView.CoreWebView2.Settings;
settings.AreDevToolsEnabled = false;            // F12 konsolni bloklash
settings.AreDefaultContextMenusEnabled = false; // Sichqoncha o'ng tugma menyusini bloklash
settings.IsStatusBarEnabled = false;            // Havola manzillarini yashirish
settings.IsZoomControlEnabled = false;          // Masshtabni qulflash
CockpitWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(9, 9, 11); // Oq chaqnashni yo'qotish
```

---

## 🛠️ Kompilyatsiya va Ishga Tushirish

### Debug rejimida yig'ish:
```powershell
dotnet build SoftechCockpit.csproj
```

### Release rejimida yig'ish:
```powershell
dotnet build -c Release SoftechCockpit.csproj
```

### Self-Contained (Mustaqil bitta fayl yoki bitta papka):
```powershell
dotnet publish -c Release -r win-x64 --self-contained true
```

---

## 📦 Inno Setup O'rnatuvchi (Installer) Yaratish

1. [Inno Setup 6.x](https://jrsoftware.org/isdl.php) dasturini o'rnating.
2. `NetCafeServer/Launcher/InnoSetup_Cockpit.iss` faylini Inno Setup Compiler orqali oching.
3. **Compile** (Ctrl+F9) tugmasini bosing.
4. Natijada `Installers/Output/SoftechCockpit_Server_Setup_v1.0.1.exe` o'rnatuvchi fayli generatsiya qilinadi.
   - O'rnatuvchi avtomatik tarzda:
     - Windows Firewall orqali port 5000 ga ruxsat beradi;
     - Ish stoliga va Start menyusiga chiroyli yorliq joylaydi;
     - Kerak bo'lsa, kompyuter yoqilganda avtomatik ishga tushishini ta'minlaydi.
