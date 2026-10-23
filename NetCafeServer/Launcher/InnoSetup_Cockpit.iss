; ==============================================================================
; Softech Game Club Management System — Standalone Cashier Cockpit Installer Script
; Inno Setup 6.x Script
; Location: NetCafeServer/Launcher/InnoSetup_Cockpit.iss
; ==============================================================================

#define MyAppName "Softech Game Club Cockpit"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "Softech Cloud Systems"
#define MyAppURL "https://softech.uz"
#define MyAppExeName "SoftechCockpit.exe"
#define SourceServerDir ".."

[Setup]
; Standart o'rnatuvchi sozlamalari
AppId={{D37F8E4A-91C2-4C9B-981D-5B7184A1A7F0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Softech Game Club
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=
OutputDir=..\..\Installers\Output
OutputBaseFilename=SoftechCockpit_Server_Setup_v1.0.1
SetupIconFile=app.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "uzbek"; MessagesFile: "compiler:Default.isl"
Name: "english"; MessagesFile: "compiler:Languages\English.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Windows yuklanganda avtomatik ishga tushirish (Auto-start)"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 1. Asosiy Standalone WPF Launcher (WinExe - CMD ochilmaydi)
Source: "bin\Release\net8.0-windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; 2. Bundled Node.js Runtime (Headless Engine)
Source: "{#SourceServerDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs

; 3. NetCafeServer Backend & REST API manbalari
Source: "{#SourceServerDir}\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs

; 4. Cashier Web UI (Glassmorphic PWA Dashboard)
Source: "{#SourceServerDir}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; 5. Node.js bog'liqliklari (node_modules)
Source: "{#SourceServerDir}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; 6. Ma'lumotlar bazasi papkasi (data - faqat yo'q bo'lsa yaratiladi)
Source: "{#SourceServerDir}\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs onlyifdoesntexist

; 7. Ilova belgisi (Ico)
Source: "app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start Menu belgisi
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Ish stoli (Desktop) belgisi
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

; Windows Startup (Avto-start)
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: startupicon

[Run]
; O'rnatish yakunlanganda ilovani ishga tushirish
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; O'chirilayotganda fondagi jarayonlarni to'xtatish
Filename: "taskkill.exe"; Parameters: "/F /IM {#MyAppExeName}"; Flags: runhidden; RunOnceId: "KillCockpitApp"
Filename: "taskkill.exe"; Parameters: "/F /IM node.exe"; Flags: runhidden; RunOnceId: "KillNodeBackend"

[Code]
// Inno Setup Pascal Script: Windows Firewall port 5000 ruxsatini qo'shish
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Port 5000 uchun Windows Firewall qoidasini kiritish (Mijoz kompyuterlari ulanishi uchun)
    Exec('netsh.exe', 'advfirewall firewall add rule name="Softech NetCafe Server (Port 5000)" dir=in action=allow protocol=TCP localport=5000', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
