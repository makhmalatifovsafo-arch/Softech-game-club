using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;

namespace NetCafeClient;

/// <summary>
/// Low-Level Keyboard Hook (WH_KEYBOARD_LL = 13) — "Temir Qulf" Keyboard Security Layer.
/// Barcha tizim tugmalarini (Win, Alt+Tab, Alt+F4, Ctrl+Esc, Ctrl+Alt+Del, Sticky Keys, va h.k.) bloklanadi.
/// LockWindow faol bo'lib, TextBox/PasswordBox fokusda bo'lsa, oddiy belgilar (harflar, raqamlar) o'tkazib yuboriladi.
/// </summary>
public static class KeyboardHook
{
    // --- Win32 Konstantalar ---
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN     = 0x0100;
    private const int WM_KEYUP       = 0x0101;
    private const int WM_SYSKEYDOWN  = 0x0104;
    private const int WM_SYSKEYUP    = 0x0105;

    // Virtual-Key kodlari
    private const int VK_TAB        = 0x09;
    private const int VK_RETURN     = 0x0D;
    private const int VK_ESCAPE     = 0x1B;
    private const int VK_SPACE      = 0x20;
    private const int VK_F1         = 0x70;
    private const int VK_F4         = 0x73;
    private const int VK_F10        = 0x79;
    private const int VK_F12        = 0x7B;
    private const int VK_LWIN       = 0x5B;
    private const int VK_RWIN       = 0x5C;
    private const int VK_DELETE     = 0x2E;
    private const int VK_MENU       = 0x12; // Alt
    private const int VK_CONTROL    = 0x11; // Ctrl
    private const int VK_SHIFT      = 0x10;
    private const int VK_NUMLOCK    = 0x90;
    private const int VK_SNAPSHOT   = 0x2C; // PrintScreen
    private const int VK_INSERT     = 0x2D;
    private const int VK_PRIOR      = 0x21; // PageUp
    private const int VK_NEXT       = 0x22; // PageDown
    private const uint LLKHF_INJECTED = 0x00000010;

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint   vkCode;
        public uint   scanCode;
        public uint   flags;
        public uint   time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    /// <summary>Admin yashirin kombinatsiyasi bosilganda hodisa</summary>
    public static event Action? OnAdminHotkeyTriggered;

    // Hook o'zgaruvchilari — delegate maydon sifatida saqlanishi shart (GC'dan himoya)
    private static IntPtr                _hookId       = IntPtr.Zero;
    private static LowLevelKeyboardProc? _proc;
    private static bool                  _isHookActive = false;

    /// <summary>LockWindow ga zaif havola — klaviatura passthrough tekshiruvi uchun.</summary>
    internal static WeakReference<LockWindow>? LockWindowRef { get; set; }

    /// <summary>Klaviaturani bloklashni yoqish</summary>
    public static void Start()
    {
        if (_isHookActive) return;

        _proc = HookCallback;

        using var curProcess = Process.GetCurrentProcess();
        using var curModule  = curProcess.MainModule;
        if (curModule != null)
        {
            _hookId       = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
            _isHookActive = (_hookId != IntPtr.Zero);
        }
    }

    /// <summary>Klaviaturani bloklashni o'chirish (chiqishdan oldin chaqirilsin)</summary>
    public static void Stop()
    {
        if (!_isHookActive || _hookId == IntPtr.Zero) return;

        UnhookWindowsHookEx(_hookId);
        _hookId       = IntPtr.Zero;
        _isHookActive = false;
    }

    // -----------------------------------------------------------------------
    // Hook callback — UI thread emas, hooking thread'da ishlaydi.
    // -----------------------------------------------------------------------
    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0)
            return CallNextHookEx(_hookId, nCode, wParam, lParam);

        bool isKeyDown = (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN);
        if (!isKeyDown)
            return CallNextHookEx(_hookId, nCode, wParam, lParam);

        var kbd    = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
        int vkCode = (int)kbd.vkCode;

        bool isAlt  = (GetAsyncKeyState(VK_MENU)    & 0x8000) != 0;
        bool isCtrl = (GetAsyncKeyState(VK_CONTROL)  & 0x8000) != 0;
        bool isShift= (GetAsyncKeyState(VK_SHIFT)    & 0x8000) != 0;
        bool isWin  = (GetAsyncKeyState(VK_LWIN)     & 0x8000) != 0
                   || (GetAsyncKeyState(VK_RWIN)     & 0x8000) != 0;

        // ---- 0. Admin Yashirin Kombinatsiyalari:
        // 1) Ctrl + Shift + Alt + F12
        // 2) Ctrl + Alt + K (Kiosk Admin)
        // 3) Ctrl + Alt + A (Admin Mode)
        const int VK_K = 0x4B;
        const int VK_A = 0x41;
        bool isAdminCombo = (isCtrl && isAlt && isShift && vkCode == VK_F12)
                         || (isCtrl && isAlt && vkCode == VK_K)
                         || (isCtrl && isAlt && vkCode == VK_A);

        if (isAdminCombo)
        {
            OnAdminHotkeyTriggered?.Invoke();
            if (LockWindowRef != null && LockWindowRef.TryGetTarget(out var lw))
            {
                lw.Dispatcher.BeginInvoke(new Action(() => lw.OpenAdminMaintenanceModal()));
            }
            return (IntPtr)1; // swallowed
        }

        // Agar dastur Dev rejimida ochilgan bo'lsa (App.IsDevMode), tizim tugmalarini o'tkazib yuboramiz
        if (App.IsDevMode)
        {
            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        // ---- 1. Windows tugmalari — har doim bloklash ----
        if (vkCode == VK_LWIN || vkCode == VK_RWIN)
            return (IntPtr)1;

        // ---- 2. Alt + Tab ----
        if (isAlt && vkCode == VK_TAB)
            return (IntPtr)1;

        // ---- 3. Alt + F4 ----
        if (isAlt && vkCode == VK_F4)
            return (IntPtr)1;

        // ---- 4. Ctrl + Esc (Start menyusi) ----
        if (isCtrl && vkCode == VK_ESCAPE)
            return (IntPtr)1;

        // ---- 5. Alt + Esc ----
        if (isAlt && vkCode == VK_ESCAPE)
            return (IntPtr)1;

        // ---- 6. Ctrl + Alt + Del ----
        if (isCtrl && isAlt && vkCode == VK_DELETE)
            return (IntPtr)1;

        // ---- 7. Ctrl + Shift + Esc (Task Manager) ----
        if (isCtrl && isShift && vkCode == VK_ESCAPE)
            return (IntPtr)1;

        // ---- 8. Win + L (Qulflash), Win + D (Ish stoli), va boshqa Win kombinatsiyalari ----
        // (Win tugmasi allaqachon bloklangan, lekin qo'shimcha himoya)
        if (isWin)
            return (IntPtr)1;

        // ---- 9. Shift + F10 (Context Menu) ----
        if (isShift && vkCode == VK_F10)
            return (IntPtr)1;

        // ---- 10. Alt + Space (oyna menyusi) ----
        if (isAlt && vkCode == VK_SPACE)
            return (IntPtr)1;

        // ---- 11. Sticky Keys trigger (5 marta Shift bosish) — F10 yoki boshqa StickyKey xavflari ----
        // StickyKey syskey bloklangan qismida ishlaydi.

        // ---- 12. PrintScreen (ekran surati olinishining oldini olish) ----
        if (vkCode == VK_SNAPSHOT)
            return (IntPtr)1;

        // ---- 13. F12 (Browser DevTools) ----
        if (vkCode == VK_F12)
            return (IntPtr)1;

        // ---- LockWindow faol va TextBox/PasswordBox fokusda bo'lsa — oddiy tugmalarni o'tkazib yuborish ----
        // Bu yerda UI threadga kirmasdan, WeakReference orqali tekshiriladi.
        // Agar LockWindow ko'rinmasa yoki ulanmagan bo'lsa — barcha bosgan tugmalarni bloklash davom etadi.
        if (IsInputFocusedInLockWindow())
        {
            // Enter va Tab ni ham o'tkazib yuborish — field switching uchun
            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        // ---- Qolgan barcha tugmalar (harflar, raqamlar, F1-F12, o'q tugmalari va h.k.) ----
        // Agar LockWindow fokusda bo'lmasa va bu oddiy kalit bo'lsa — bloklash
        // (Bu foydalanuvchi oyindan kalitni bosganda LockWindow ko'rinmaydi degan holat)
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    /// <summary>
    /// LockWindow ko'rinadigan va TextBox / PasswordBox fokusda ekanini tekshiradi.
    /// UI thread'da qisqa Dispatcher.Invoke ishlatiladi.
    /// </summary>
    private static bool IsInputFocusedInLockWindow()
    {
        try
        {
            bool result = false;
            if (LockWindowRef != null && LockWindowRef.TryGetTarget(out var lw))
            {
                lw.Dispatcher.Invoke(() =>
                {
                    if (lw.Visibility == Visibility.Visible)
                    {
                        var focused = Keyboard.FocusedElement;
                        result = focused is System.Windows.Controls.TextBox
                              || focused is System.Windows.Controls.PasswordBox;
                    }
                }, System.Windows.Threading.DispatcherPriority.Send);
            }
            return result;
        }
        catch
        {
            return false;
        }
    }
}
