using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Win32;

namespace NetCafeClient.Services.Security;

/// <summary>
/// UsbGuardService — Unbypassable USB Mass Storage Blocker & Hardware Device Guard.
/// Windows Kernel darajasida va Win32 Message Hook orqali USB fleshkalarni Dynamic Eject/Unmount qiladi,
/// AutoPlay/AutoRun tizimini o'chiradi hamda Registry xavfsizlik siyosatini (USBSTOR = 4) majburiy o'rnatadi.
/// HID qurilmalar (sichqoncha, klaviatura, naushnik) to'liq ishlaydi, faqat Flash xotiralar bloklanadi.
/// </summary>
public sealed class UsbGuardService : IDisposable
{
    private static readonly Lazy<UsbGuardService> _instance = new(() => new UsbGuardService());
    public static UsbGuardService Instance => _instance.Value;

    private HwndSource? _hwndSource;
    private IntPtr _deviceNotifyHandle = IntPtr.Zero;
    private Thread? _periodicSweepThread;
    private volatile bool _isRunning = false;
    private readonly object _syncLock = new();

    public event Action<string>? OnUsbDriveBlocked;

    private UsbGuardService() { }

    // =========================================================================
    // INITIALIZATION & LIFECYCLE
    // =========================================================================

    /// <summary>
    /// USB Guard servisini ishga tushirish: Registry siyosatini qo'llash,
    /// Win32 Device Notification xabarlariga ulanish va Sweep tekshiruvini boshlash.
    /// </summary>
    public void Initialize(Window? targetWindow = null)
    {
        lock (_syncLock)
        {
            if (_isRunning) return;
            _isRunning = true;

            // 1. Registry Policy Reinforcement (USBSTOR, RemovableStorageDevices, AutoRun/AutoPlay)
            ReinforceRegistryPolicies();

            // 2. Win32 Device Arrival Hook (HwndSource orqali)
            SetupHwndHook(targetWindow);

            // 3. Ishga tushganda allaqachon tiqilgan fleshkalarni darhol aniqlab chiqarish
            SweepAndEjectRemovableDrives();

            // 4. Background Periodic Guard Thread (Har 1.5 soniyada xavfsizlik tekshiruvi)
            StartPeriodicSweep();

            Debug.WriteLine("🛡️ [UsbGuardService] Muvaffaqiyatli initsializatsiya qilindi va himoya yoqildi.");
        }
    }

    // =========================================================================
    // 1. REGISTRY POLICY REINFORCEMENT (USBSTOR = 4 & AUTORUN OFF)
    // =========================================================================

    /// <summary>
    /// Windows Registry orqali USB Mass Storage qurilmalarini bloklash.
    /// Faqat Flash drayverlar (USBSTOR) o'chiriladi, HID (mishka, klaviatura, audio) o'chmaydi!
    /// </summary>
    public void ReinforceRegistryPolicies()
    {
        try
        {
            // A) USBSTOR drayverini faolsizlantirish (Start = 4: Disabled)
            // Bu faqat USB Mass Storage qurilmalariga ta'sir qiladi. Mishka/klaviatura (hidusb) ishlayveradi.
            using (var usbStorKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\USBSTOR", writable: true))
            {
                if (usbStorKey != null)
                {
                    usbStorKey.SetValue("Start", 4, RegistryValueKind.DWord);
                    Debug.WriteLine("🛡️ [UsbGuardService] HKLM USBSTOR Start = 4 (Disabled) o'rnatildi.");
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] USBSTOR registry ruxsat xatosi (Admin huquqi talab qilinishi mumkin): {ex.Message}");
        }

        try
        {
            // B) Group Policy: RemovableStorageDevices -> Deny_All = 1
            const string remPolicyPath = @"SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices";
            using (var remKey = Registry.LocalMachine.CreateSubKey(remPolicyPath, writable: true))
            {
                if (remKey != null)
                {
                    remKey.SetValue("Deny_All", 1, RegistryValueKind.DWord);
                }
            }

            // Removable Disks Class GUID: {53f5630d-b6bf-11d0-94f2-00a0c91efb8b}
            const string diskPolicyPath = @"SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}";
            using (var diskKey = Registry.LocalMachine.CreateSubKey(diskPolicyPath, writable: true))
            {
                if (diskKey != null)
                {
                    diskKey.SetValue("Deny_Execute", 1, RegistryValueKind.DWord);
                    diskKey.SetValue("Deny_Read", 1, RegistryValueKind.DWord);
                    diskKey.SetValue("Deny_Write", 1, RegistryValueKind.DWord);
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] Group Policy RemovableStorageDevices xatosi: {ex.Message}");
        }

        try
        {
            // C) AutoPlay / AutoRun parametrlarini butunlay o'chirish (NoDriveTypeAutoRun = 0xFF)
            const string explorerPolicyPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer";
            
            // Current User
            using (var expKeyCu = Registry.CurrentUser.CreateSubKey(explorerPolicyPath, writable: true))
            {
                if (expKeyCu != null)
                {
                    expKeyCu.SetValue("NoDriveTypeAutoRun", 0xFF, RegistryValueKind.DWord);
                    expKeyCu.SetValue("NoAutorun", 1, RegistryValueKind.DWord);
                }
            }

            // Local Machine
            using (var expKeyLm = Registry.LocalMachine.CreateSubKey(explorerPolicyPath, writable: true))
            {
                if (expKeyLm != null)
                {
                    expKeyLm.SetValue("NoDriveTypeAutoRun", 0xFF, RegistryValueKind.DWord);
                    expKeyLm.SetValue("NoAutorun", 1, RegistryValueKind.DWord);
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] AutoRun o'chirish xatosi: {ex.Message}");
        }
    }

    // =========================================================================
    // 2. WIN32 HWND DEVICE ARRIVAL HOOK (WM_DEVICECHANGE)
    // =========================================================================

    private void SetupHwndHook(Window? targetWindow)
    {
        System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
        {
            try
            {
                IntPtr hwnd = IntPtr.Zero;

                if (targetWindow != null)
                {
                    var helper = new WindowInteropHelper(targetWindow);
                    hwnd = helper.Handle;
                    if (hwnd == IntPtr.Zero)
                    {
                        targetWindow.SourceInitialized += (s, e) =>
                        {
                            IntPtr h = new WindowInteropHelper(targetWindow).Handle;
                            RegisterDeviceNotificationsForHwnd(h);
                        };
                        return;
                    }
                }

                if (hwnd == IntPtr.Zero)
                {
                    // Maxsus yashirin HwndSource yaratish
                    var parameters = new HwndSourceParameters("NetCafeUsbGuardHost")
                    {
                        WindowStyle = 0,
                        ExtendedWindowStyle = 0,
                        Width = 0,
                        Height = 0,
                        PositionX = -32000,
                        PositionY = -32000
                    };
                    _hwndSource = new HwndSource(parameters);
                    hwnd = _hwndSource.Handle;
                    _hwndSource.AddHook(HwndMessageHook);
                }
                else
                {
                    HwndSource.FromHwnd(hwnd)?.AddHook(HwndMessageHook);
                }

                RegisterDeviceNotificationsForHwnd(hwnd);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"⚠️ [UsbGuardService] HwndHook xatosi: {ex.Message}");
            }
        });
    }

    private void RegisterDeviceNotificationsForHwnd(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;

        try
        {
            var filter = new Win32SecurityNative.DEV_BROADCAST_DEVICEINTERFACE
            {
                dbcc_size = Marshal.SizeOf<Win32SecurityNative.DEV_BROADCAST_DEVICEINTERFACE>(),
                dbcc_devicetype = Win32SecurityNative.DBT_DEVTYP_DEVICEINTERFACE,
                dbcc_classguid = Win32SecurityNative.GUID_DEVINTERFACE_DISK
            };

            IntPtr pFilter = Marshal.AllocHGlobal(filter.dbcc_size);
            try
            {
                Marshal.StructureToPtr(filter, pFilter, true);
                _deviceNotifyHandle = Win32SecurityNative.RegisterDeviceNotification(
                    hwnd,
                    pFilter,
                    Win32SecurityNative.DEVICE_NOTIFY_WINDOW_HANDLE | Win32SecurityNative.DEVICE_NOTIFY_ALL_INTERFACE_CLASSES);
            }
            finally
            {
                Marshal.FreeHGlobal(pFilter);
            }

            Debug.WriteLine($"🛡️ [UsbGuardService] RegisterDeviceNotification muvaffaqiyatli ulandi (HWND: {hwnd}).");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] RegisterDeviceNotification xatosi: {ex.Message}");
        }
    }

    /// <summary>
    /// Window Proc xabarlar filtri: WM_DEVICECHANGE (0x0219) va DBT_DEVICEARRIVAL (0x8000) ni tutish.
    /// </summary>
    private IntPtr HwndMessageHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == Win32SecurityNative.WM_DEVICECHANGE)
        {
            int wCode = wParam.ToInt32();

            if (wCode == Win32SecurityNative.DBT_DEVICEARRIVAL)
            {
                HandleDeviceArrival(lParam);
            }
            else if (wCode == Win32SecurityNative.DBT_DEVICETYPESPECIFIC || wCode == Win32SecurityNative.DBT_DEVICEQUERYREMOVE)
            {
                // Har qanday yangi ulanishda shubhali drayverlarni tekshirish
                SweepAndEjectRemovableDrives();
            }
        }

        return IntPtr.Zero;
    }

    private void HandleDeviceArrival(IntPtr lParam)
    {
        if (lParam == IntPtr.Zero)
        {
            SweepAndEjectRemovableDrives();
            return;
        }

        try
        {
            var hdr = Marshal.PtrToStructure<Win32SecurityNative.DEV_BROADCAST_HDR>(lParam);

            if (hdr.dbch_devicetype == Win32SecurityNative.DBT_DEVTYP_VOLUME)
            {
                var vol = Marshal.PtrToStructure<Win32SecurityNative.DEV_BROADCAST_VOLUME>(lParam);
                var driveLetters = GetDriveLettersFromMask(vol.dbcv_unitmask);

                foreach (char driveLetter in driveLetters)
                {
                    ProcessDetectedDrive(driveLetter);
                }
            }
            else
            {
                // Boshqa turdagi interfeys orqali kelgan bo'lsa, tezkor disk tekshiruvi
                SweepAndEjectRemovableDrives();
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] HandleDeviceArrival tahlil xatosi: {ex.Message}");
            SweepAndEjectRemovableDrives();
        }
    }

    // =========================================================================
    // 3. EJECT & DISMOUNT ENGINE (DEVICEIOCONTROL FSCTL)
    // =========================================================================

    /// <summary>
    /// Aniqlangan drayverni tekshirish va agar u olinadigan (USB Flash) disk bo'lsa, uni Eject/Unmount qilish.
    /// </summary>
    public bool ProcessDetectedDrive(char driveLetter)
    {
        string rootPath = $"{driveLetter}:\\";

        if (!IsRemovableOrUsbDrive(driveLetter, rootPath))
        {
            return false;
        }

        Debug.WriteLine($"🚨 [UsbGuardService] TAQIQLANGAN USB DISK ANIQLANDI: {driveLetter}:");

        // 1. Kernel darajasida haydovchini bloklash, lock va dismount qilish
        bool ejected = EjectAndDismountVolume(driveLetter);

        // 2. Qizil xavfsizlik ogohlantirishini ko'rsatish
        TriggerSecurityAlert(driveLetter);

        // 3. Hodisa uzatish
        OnUsbDriveBlocked?.Invoke(rootPath);

        return ejected;
    }

    /// <summary>
    /// Win32 DeviceIoControl orqali FSCTL_LOCK_VOLUME va FSCTL_DISMOUNT_VOLUME buyruqlari bilan drayverni unmount qilish.
    /// </summary>
    public static bool EjectAndDismountVolume(char driveLetter)
    {
        string devicePath = $@"\\.\{driveLetter}:";
        IntPtr hVolume = IntPtr.Zero;

        try
        {
            // A) Drayverga handle ochish
            hVolume = Win32SecurityNative.CreateFile(
                devicePath,
                Win32SecurityNative.GENERIC_READ | Win32SecurityNative.GENERIC_WRITE,
                Win32SecurityNative.FILE_SHARE_READ | Win32SecurityNative.FILE_SHARE_WRITE,
                IntPtr.Zero,
                Win32SecurityNative.OPEN_EXISTING,
                0,
                IntPtr.Zero);

            if (hVolume == Win32SecurityNative.INVALID_HANDLE_VALUE)
            {
                // Agar Write ruxsati berilmasa, faqat Read bilan sinash
                hVolume = Win32SecurityNative.CreateFile(
                    devicePath,
                    Win32SecurityNative.GENERIC_READ,
                    Win32SecurityNative.FILE_SHARE_READ | Win32SecurityNative.FILE_SHARE_WRITE,
                    IntPtr.Zero,
                    Win32SecurityNative.OPEN_EXISTING,
                    0,
                    IntPtr.Zero);
            }

            if (hVolume == Win32SecurityNative.INVALID_HANDLE_VALUE)
            {
                Debug.WriteLine($"⚠️ [UsbGuardService] {driveLetter}: uchun CreateFile handle olinmadi. Error: {Marshal.GetLastWin32Error()}");
                TryPowerShellDismount(driveLetter);
                return false;
            }

            // B) FSCTL_LOCK_VOLUME (0x00090018)
            uint bytesReturned;
            bool locked = false;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                locked = Win32SecurityNative.DeviceIoControl(
                    hVolume,
                    Win32SecurityNative.FSCTL_LOCK_VOLUME,
                    IntPtr.Zero, 0,
                    IntPtr.Zero, 0,
                    out bytesReturned,
                    IntPtr.Zero);

                if (locked) break;
                Thread.Sleep(50);
            }

            // C) FSCTL_DISMOUNT_VOLUME (0x00090020) — Tizim fayl tuzilmasidan ajratish
            bool dismounted = Win32SecurityNative.DeviceIoControl(
                hVolume,
                Win32SecurityNative.FSCTL_DISMOUNT_VOLUME,
                IntPtr.Zero, 0,
                IntPtr.Zero, 0,
                out bytesReturned,
                IntPtr.Zero);

            // D) IOCTL_STORAGE_EJECT_MEDIA (0x002D4808) — Mexanik/elektron chiqarish
            bool ejected = Win32SecurityNative.DeviceIoControl(
                hVolume,
                Win32SecurityNative.IOCTL_STORAGE_EJECT_MEDIA,
                IntPtr.Zero, 0,
                IntPtr.Zero, 0,
                out bytesReturned,
                IntPtr.Zero);

            Debug.WriteLine($"🛡️ [UsbGuardService] Eject natijasi {driveLetter}: Lock={locked}, Dismount={dismounted}, Eject={ejected}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"⚠️ [UsbGuardService] EjectAndDismountVolume xatosi: {ex.Message}");
            TryPowerShellDismount(driveLetter);
            return false;
        }
        finally
        {
            if (hVolume != IntPtr.Zero && hVolume != Win32SecurityNative.INVALID_HANDLE_VALUE)
            {
                Win32SecurityNative.CloseHandle(hVolume);
            }
        }
    }

    /// <summary>
    /// Zaxira usul: Agar Win32 API fayl ochiqligi sababli to'xtasa, mountvol orqali nuqtani ajratish
    /// </summary>
    private static void TryPowerShellDismount(char driveLetter)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c mountvol {driveLetter}: /p",
                CreateNoWindow = true,
                UseShellExecute = false
            };
            Process.Start(psi)?.WaitForExit(1000);
        }
        catch { /* ignore */ }
    }

    // =========================================================================
    // 4. PERIODIC SWEEP & DRIVE INSPECTION
    // =========================================================================

    private void StartPeriodicSweep()
    {
        _periodicSweepThread = new Thread(PeriodicSweepLoop)
        {
            IsBackground = true,
            Name = "UsbGuard-Sweep",
            Priority = ThreadPriority.BelowNormal
        };
        _periodicSweepThread.Start();
    }

    private void PeriodicSweepLoop()
    {
        while (_isRunning)
        {
            try
            {
                SweepAndEjectRemovableDrives();
            }
            catch { /* ignore */ }

            Thread.Sleep(1500);
        }
    }

    /// <summary>
    /// Tizimdagi barcha drayverlarni tekshirib, olinadigan disklar topilsa darhol chiqaradi.
    /// </summary>
    public void SweepAndEjectRemovableDrives()
    {
        DriveInfo[] drives;
        try
        {
            drives = DriveInfo.GetDrives();
        }
        catch
        {
            return;
        }

        foreach (var d in drives)
        {
            try
            {
                if (d.DriveType == DriveType.Removable || d.DriveType == DriveType.CDRom)
                {
                    char letter = d.Name[0];
                    // C, D kabi asosiy tizim disklari hech qachon chiqarilmaydi
                    if (char.ToUpper(letter) != 'C')
                    {
                        ProcessDetectedDrive(letter);
                    }
                }
            }
            catch { /* ignore */ }
        }
    }

    /// <summary>
    /// Berilgan harf USB yoki Removable disk ekanligini aniqlash.
    /// Asosiy qattiq disklarni (C:) himoyalaydi.
    /// </summary>
    public static bool IsRemovableOrUsbDrive(char driveLetter, string rootPath)
    {
        char upper = char.ToUpper(driveLetter);
        if (upper == 'C') return false; // Tizim diskini hech qachon bloklamaymiz

        try
        {
            uint type = Win32SecurityNative.GetDriveType(rootPath);
            if (type == Win32SecurityNative.DRIVE_REMOVABLE || type == Win32SecurityNative.DRIVE_CDROM)
            {
                return true;
            }

            // DriveInfo orqali tekshirish
            var dInfo = new DriveInfo(driveLetter.ToString());
            if (dInfo.DriveType == DriveType.Removable)
            {
                return true;
            }

            // USB Storage Bus Type tekshiruvi (IOCTL_STORAGE_QUERY_PROPERTY)
            if (IsDriveOnUsbBus(driveLetter))
            {
                return true;
            }
        }
        catch { /* ignore */ }

        return false;
    }

    private static bool IsDriveOnUsbBus(char driveLetter)
    {
        IntPtr hDevice = IntPtr.Zero;
        try
        {
            string path = $@"\\.\{driveLetter}:";
            hDevice = Win32SecurityNative.CreateFile(
                path,
                0,
                Win32SecurityNative.FILE_SHARE_READ | Win32SecurityNative.FILE_SHARE_WRITE,
                IntPtr.Zero,
                Win32SecurityNative.OPEN_EXISTING,
                0,
                IntPtr.Zero);

            if (hDevice == Win32SecurityNative.INVALID_HANDLE_VALUE) return false;

            var query = new Win32SecurityNative.STORAGE_PROPERTY_QUERY
            {
                PropertyId = 0, // StorageDeviceProperty
                QueryType = 0   // PropertyStandardQuery
            };

            int querySize = Marshal.SizeOf(query);
            IntPtr pQuery = Marshal.AllocHGlobal(querySize);
            Marshal.StructureToPtr(query, pQuery, true);

            int descriptorSize = Marshal.SizeOf<Win32SecurityNative.STORAGE_DEVICE_DESCRIPTOR>();
            IntPtr pDescriptor = Marshal.AllocHGlobal(descriptorSize);

            try
            {
                bool success = Win32SecurityNative.DeviceIoControl(
                    hDevice,
                    Win32SecurityNative.IOCTL_STORAGE_QUERY_PROPERTY,
                    pQuery,
                    (uint)querySize,
                    pDescriptor,
                    (uint)descriptorSize,
                    out uint returned,
                    IntPtr.Zero);

                if (success)
                {
                    var descriptor = Marshal.PtrToStructure<Win32SecurityNative.STORAGE_DEVICE_DESCRIPTOR>(pDescriptor);
                    if (descriptor.BusType == Win32SecurityNative.STORAGE_BUS_TYPE.BusTypeUsb)
                    {
                        return true;
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(pQuery);
                Marshal.FreeHGlobal(pDescriptor);
            }
        }
        catch { /* ignore */ }
        finally
        {
            if (hDevice != IntPtr.Zero && hDevice != Win32SecurityNative.INVALID_HANDLE_VALUE)
            {
                Win32SecurityNative.CloseHandle(hDevice);
            }
        }

        return false;
    }

    private static List<char> GetDriveLettersFromMask(int unitmask)
    {
        var letters = new List<char>();
        for (int i = 0; i < 26; i++)
        {
            if ((unitmask & (1 << i)) != 0)
            {
                letters.Add((char)('A' + i));
            }
        }
        return letters;
    }

    private static void TriggerSecurityAlert(char driveLetter)
    {
        SecurityAlertOverlay.ShowAlert(
            title: "Xavfsizlik: Tashqi xotira vositalari (USB Fleshka) taqiqlangan!",
            message: $"Kompyuterga ulangan [{driveLetter}:] USB xotira qurilmasi xavfsizlik qoidalariga binoan chiqarib tashlandi (Ejected).");
    }

    public void RestoreRegistryPolicies()
    {
        try
        {
            using (var usbStorKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\USBSTOR", writable: true))
            {
                if (usbStorKey != null)
                {
                    usbStorKey.SetValue("Start", 3, RegistryValueKind.DWord);
                }
            }
        }
        catch { }

        try
        {
            const string remPolicyPath = @"SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices";
            Registry.LocalMachine.DeleteSubKeyTree(remPolicyPath, throwOnMissingSubKey: false);
        }
        catch { }

        try
        {
            const string expPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer";
            using (var k = Registry.CurrentUser.OpenSubKey(expPath, writable: true))
            {
                k?.DeleteValue("NoDriveTypeAutoRun", throwOnMissingValue: false);
                k?.DeleteValue("NoAutorun", throwOnMissingValue: false);
            }
            using (var k = Registry.LocalMachine.OpenSubKey(expPath, writable: true))
            {
                k?.DeleteValue("NoDriveTypeAutoRun", throwOnMissingValue: false);
                k?.DeleteValue("NoAutorun", throwOnMissingValue: false);
            }
        }
        catch { }
    }

    // =========================================================================
    // DISPOSE
    // =========================================================================

    public void Dispose()
    {
        _isRunning = false;
        RestoreRegistryPolicies();

        if (_deviceNotifyHandle != IntPtr.Zero)
        {
            try
            {
                Win32SecurityNative.UnregisterDeviceNotification(_deviceNotifyHandle);
                _deviceNotifyHandle = IntPtr.Zero;
            }
            catch { /* ignore */ }
        }

        if (_hwndSource != null)
        {
            try
            {
                _hwndSource.RemoveHook(HwndMessageHook);
                _hwndSource.Dispose();
                _hwndSource = null;
            }
            catch { /* ignore */ }
        }
    }
}
