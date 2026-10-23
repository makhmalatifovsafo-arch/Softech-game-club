@echo off
title Build Standalone NetCafeClient.exe
cd /d "%~dp0"
echo =========================================================
echo   Compiling NetCafeClient into Standalone Single-File EXE
echo   Target: win-x64, Self-Contained (.NET 8 Runtime Embedded)
echo =========================================================
dotnet publish -c Release /p:PublishProfile=StandaloneWin64
echo.
echo =========================================================
echo   Build complete! Standalone executable is in publish\
echo =========================================================
pause
