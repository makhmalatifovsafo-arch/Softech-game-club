@echo off
title Softech NetCafe Pro Server
cd /d "%~dp0"
echo ===================================================
echo   Softech NetCafe Pro - Core Engine Server
echo ===================================================

:: Windows Firewall qoidasini tekshirish va port 5000 ni ochish
netsh advfirewall firewall show rule name="NetCafe Server Port 5000" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="NetCafe Server Port 5000" dir=in action=allow protocol=TCP localport=5000 >nul 2>&1
)

if exist ".\runtime\node.exe" (
    set "PATH=%~dp0runtime;%PATH%"
    ".\runtime\node.exe" src/server.js
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        node src/server.js
    ) else (
        echo [XATOLIK] Node.js topilmadi! Iltimos, server papkasida runtime\node.exe mavjudligiga ishonch hosil qiling.
        pause
    )
)

if %errorlevel% neq 0 (
    echo.
    echo [XATOLIK] Server to'xtatildi yoki xatolik yuz berdi.
    pause
)
