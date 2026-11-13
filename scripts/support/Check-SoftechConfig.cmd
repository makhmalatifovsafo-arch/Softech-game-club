@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
if not exist "C:\SoftechServer\runtime\node.exe" (
  echo Softech runtime topilmadi. Softech ornashgan papkani tekshiring.
  pause
  exit /b 1
)
"C:\SoftechServer\runtime\node.exe" "%~dp0Check-SoftechConfig.mjs"
echo.
pause
