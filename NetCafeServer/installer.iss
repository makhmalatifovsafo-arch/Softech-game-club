; Script generated for Inno Setup 6
; Softech Game Club Management System — Standalone Server Installer

#define MyAppName "Softech NetCafe Server"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Softech Systems"
#define MyAppURL "http://localhost:5000"
#define MyAppExeName "SoftechCockpit.exe"

[Setup]
AppId={{9F5F1B3C-4321-4E67-A012-9A8C7F33412B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\SoftechServer
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=SoftechServerSetup_Inno
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startupicon"; Description: "Windows yoqilganda avtomatik ishga tushsin"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Bundled runtime (Zero Node.js dependency on target machine)
Source: "runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
; Server source files
Source: "src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "SoftechCockpit.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "app.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "schema.sql"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-server.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "start_server.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "start_server_background.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\SoftechServerBackground"; Filename: "{app}\start_server_background.vbs"; Tasks: startupicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent
