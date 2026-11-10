using System;
using System.Runtime.InteropServices;

namespace SoftechCockpit
{
    // Native monitor coordinates are physical pixels, including on mixed-DPI displays.
    public static class WindowWorkArea
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MinMaxInfo
        {
            public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct MonitorInfo
        {
            public int Size;
            public Rect Monitor, Work;
            public uint Flags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

        public static MinMaxInfo Fit(MinMaxInfo info, Rect monitor, Rect work)
        {
            int width = work.Right - work.Left, height = work.Bottom - work.Top;
            if (width <= 0 || height <= 0) return info;
            info.MaxPosition.X = work.Left - monitor.Left;
            info.MaxPosition.Y = work.Top - monitor.Top;
            info.MaxSize.X = width;
            info.MaxSize.Y = height;
            // A high DPI/small display must not force the window beneath the taskbar.
            info.MinTrackSize.X = Math.Min(info.MinTrackSize.X, width);
            info.MinTrackSize.Y = Math.Min(info.MinTrackSize.Y, height);
            return info;
        }

        public static bool Apply(IntPtr window, IntPtr data)
        {
            if (data == IntPtr.Zero) return false;
            var monitor = MonitorFromWindow(window, 2); // MONITOR_DEFAULTTONEAREST
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;
            var bounds = (MinMaxInfo)Marshal.PtrToStructure(data, typeof(MinMaxInfo));
            Marshal.StructureToPtr(Fit(bounds, info.Monitor, info.Work), data, false);
            return true;
        }
    }
}
