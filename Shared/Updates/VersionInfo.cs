using System.Reflection;

namespace Softech.Updates
{
    public static class VersionInfo
    {
        public static string Display
        {
            get { return "v" + Assembly.GetExecutingAssembly().GetName().Version.ToString(3); }
        }
        public static string ClientLabel { get { return "Softech Client · " + Display; } }
    }
}
