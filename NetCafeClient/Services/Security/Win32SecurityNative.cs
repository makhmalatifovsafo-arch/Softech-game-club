using System;
using System.Runtime.InteropServices;

namespace NetCafeClient.Services.Security;

/// <summary>
/// Win32 P/Invoke deklaratsiyalari va tizim tuzilmalari.
/// Hardware va USB drayverlarini kernel darajasida boshqarish va unmount qilish uchun.
/// </summary>
public static class Win32SecurityNative
{
    // =========================================================================
    // WINDOWS MESSAGES & DEVICE CHANGE CONSTANTS
    // =========================================================================
    public const int WM_DEVICECHANGE               = 0x0219;
    public const int DBT_DEVICEARRIVAL             = 0x8000;
    public const int DBT_DEVICEQUERYREMOVE          = 0x8001;
    public const int DBT_DEVICEQUERYREMOVEFAILED    = 0x8002;
    public const int DBT_DEVICEREMOVEPENDING       = 0x8003;
    public const int DBT_DEVICEREMOVECOMPLETE      = 0x8004;
    public const int DBT_DEVICETYPESPECIFIC        = 0x8005;

    public const int DBT_DEVTYP_OEM                = 0x0000;
    public const int DBT_DEVTYP_DEVNODE            = 0x0001;
    public const int DBT_DEVTYP_VOLUME             = 0x0002;
    public const int DBT_DEVTYP_PORT               = 0x0003;
    public const int DBT_DEVTYP_NET                = 0x0004;
    public const int DBT_DEVTYP_DEVICEINTERFACE    = 0x0005;
    public const int DBT_DEVTYP_HANDLE             = 0x0006;

    public const int DEVICE_NOTIFY_WINDOW_HANDLE   = 0x00000000;
    public const int DEVICE_NOTIFY_SERVICE_HANDLE  = 0x00000001;
    public const int DEVICE_NOTIFY_ALL_INTERFACE_CLASSES = 0x00000004;

    // =========================================================================
    // FILE & DEVICE ACCESS CONSTANTS
    // =========================================================================
    public const uint GENERIC_READ                 = 0x80000000;
    public const uint GENERIC_WRITE                = 0x40000000;
    public const uint FILE_SHARE_READ              = 0x00000001;
    public const uint FILE_SHARE_WRITE             = 0x00000002;
    public const uint OPEN_EXISTING                = 3;
    public const uint FILE_ATTRIBUTE_NORMAL        = 0x00000080;
    public static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    // =========================================================================
    // FSCTL & IOCTL CONTROL CODES (DEVICE EJECT & DISMOUNT)
    // =========================================================================
    // FSCTL_LOCK_VOLUME    = CTL_CODE(FILE_DEVICE_FILE_SYSTEM,  6, METHOD_BUFFERED, FILE_ANY_ACCESS)
    public const uint FSCTL_LOCK_VOLUME            = 0x00090018;

    // FSCTL_UNLOCK_VOLUME  = CTL_CODE(FILE_DEVICE_FILE_SYSTEM,  7, METHOD_BUFFERED, FILE_ANY_ACCESS)
    public const uint FSCTL_UNLOCK_VOLUME          = 0x0009001C;

    // FSCTL_DISMOUNT_VOLUME= CTL_CODE(FILE_DEVICE_FILE_SYSTEM,  8, METHOD_BUFFERED, FILE_ANY_ACCESS)
    public const uint FSCTL_DISMOUNT_VOLUME        = 0x00090020;

    // IOCTL_STORAGE_EJECT_MEDIA = CTL_CODE(IOCTL_STORAGE_BASE, 0x0202, METHOD_BUFFERED, FILE_READ_ACCESS)
    public const uint IOCTL_STORAGE_EJECT_MEDIA    = 0x002D4808;

    // IOCTL_STORAGE_QUERY_PROPERTY = CTL_CODE(IOCTL_STORAGE_BASE, 0x0500, METHOD_BUFFERED, FILE_ANY_ACCESS)
    public const uint IOCTL_STORAGE_QUERY_PROPERTY = 0x002D1400;

    // =========================================================================
    // DRIVE TYPES
    // =========================================================================
    public const uint DRIVE_UNKNOWN                = 0;
    public const uint DRIVE_NO_ROOT_DIR            = 1;
    public const uint DRIVE_REMOVABLE              = 2;
    public const uint DRIVE_FIXED                  = 3;
    public const uint DRIVE_REMOTE                 = 4;
    public const uint DRIVE_CDROM                  = 5;
    public const uint DRIVE_RAMDISK                = 6;

    // =========================================================================
    // DEVICE INTERFACE GUIDS
    // =========================================================================
    // GUID_DEVINTERFACE_DISK
    public static readonly Guid GUID_DEVINTERFACE_DISK = new("53f56307-b6bf-11d0-94f2-00a0c91efb8b");

    // GUID_DEVINTERFACE_VOLUME
    public static readonly Guid GUID_DEVINTERFACE_VOLUME = new("53f5630d-b6bf-11d0-94f2-00a0c91efb8b");

    // GUID_DEVINTERFACE_USB_DEVICE
    public static readonly Guid GUID_DEVINTERFACE_USB_DEVICE = new("A5DCBF10-6530-11D2-901F-00C04FB951ED");

    // =========================================================================
    // MARSHALED STRUCTS
    // =========================================================================
    [StructLayout(LayoutKind.Sequential)]
    public struct DEV_BROADCAST_HDR
    {
        public int dbch_size;
        public int dbch_devicetype;
        public int dbch_reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DEV_BROADCAST_VOLUME
    {
        public int dbcv_size;
        public int dbcv_devicetype;
        public int dbcv_reserved;
        public int dbcv_unitmask;
        public short dbcv_flags;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct DEV_BROADCAST_DEVICEINTERFACE
    {
        public int dbcc_size;
        public int dbcc_devicetype;
        public int dbcc_reserved;
        public Guid dbcc_classguid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 255)]
        public string dbcc_name;
    }

    public enum STORAGE_BUS_TYPE
    {
        BusTypeUnknown = 0,
        BusTypeScsi,
        BusTypeAtapi,
        BusTypeAta,
        BusType1394,
        BusTypeSsa,
        BusTypeFibre,
        BusTypeUsb,
        BusTypeRaid,
        BusTypeiScsi,
        BusTypeSas,
        BusTypeSata,
        BusTypeSd,
        BusTypeMmc,
        BusTypeVirtual,
        BusTypeFileBackedVirtual,
        BusTypeSpaces,
        BusTypeNvme,
        BusTypeScm,
        BusTypeUfs,
        BusTypeMax,
        BusTypeMaxReserved = 0x7F
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STORAGE_PROPERTY_QUERY
    {
        public int PropertyId;
        public int QueryType;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 1)]
        public byte[] AdditionalParameters;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STORAGE_DEVICE_DESCRIPTOR
    {
        public int Version;
        public int Size;
        public byte DeviceType;
        public byte DeviceTypeModifier;
        [MarshalAs(UnmanagedType.U1)]
        public bool RemovableMedia;
        [MarshalAs(UnmanagedType.U1)]
        public bool CommandQueueing;
        public int VendorIdOffset;
        public int ProductIdOffset;
        public int ProductRevisionOffset;
        public int SerialNumberOffset;
        public STORAGE_BUS_TYPE BusType;
        public int RawPropertiesLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 512)]
        public byte[] RawDeviceProperties;
    }

    // =========================================================================
    // P/INVOKE FUNCTIONS
    // =========================================================================
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr RegisterDeviceNotification(
        IntPtr hRecipient,
        IntPtr NotificationFilter,
        int Flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnregisterDeviceNotification(IntPtr Handle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DeviceIoControl(
        IntPtr hDevice,
        uint dwIoControlCode,
        IntPtr lpInBuffer,
        uint nInBufferSize,
        IntPtr lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern uint GetDriveType(string lpRootPathName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern uint QueryDosDevice(string lpDeviceName, System.Text.StringBuilder lpTargetPath, int ucchMax);
}
