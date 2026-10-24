@echo off
cd /d "C:\Users\Pc 4\.gemini\antigravity\scratch\Softech game club\NetCafeServer"

:: 1. Eski server jarayoni to'xtashini kutish
timeout /t 2 /nobreak >nul 2>&1

:: 2. Zaxira nusxasi yaratilmoqda (netcafe.db daxlsiz qoladi)
if not exist "backup_v1.0.2" mkdir "backup_v1.0.2" >nul 2>&1
if exist "src" xcopy /E /I /Y "src" "backup_v1.0.2\src" >nul 2>&1
if exist "public" xcopy /E /I /Y "public" "backup_v1.0.2\public" >nul 2>&1
if exist "package.json" copy /Y "package.json" "backup_v1.0.2\package.json" >nul 2>&1

:: 3. Yangi fayllar ko'chirilmoqda
xcopy /E /I /Y "C:\Users\Pc 4\.gemini\antigravity\scratch\Softech game club\NetCafeServer\updates\v1.0.3\*" "." >nul 2>&1

:: 4. Serverni qora oynasiz, orqa fonda qayta ishga tushirish
if exist "SoftechCockpit.exe" (
    start "" "SoftechCockpit.exe"
) else if exist "start_server_background.vbs" (
    start "" wscript.exe //B //Nologo "start_server_background.vbs"
) else if exist ".\runtime\node.exe" (
    start "" /B ".\runtime\node.exe" src/server.js
) else (
    start "" /B node src/server.js
)

exit
