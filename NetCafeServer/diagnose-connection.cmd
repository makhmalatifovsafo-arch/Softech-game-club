@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" "diagnose-connection.mjs"
) else (
  node "diagnose-connection.mjs"
)
pause
