@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
if not exist "C:\SoftechServer\runtime\node.exe" (
  echo Softech runtime topilmadi.
  pause
  exit /b 1
)
"C:\SoftechServer\runtime\node.exe" "%~dp0Recover-Club10.mjs"
echo.
pause
