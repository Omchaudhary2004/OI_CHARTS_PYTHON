@echo off
title My App
cls

:MENU
echo.
echo ================================
echo        MY APP LAUNCHER
echo ================================
echo.
echo   [1] Start App
echo   [2] Stop App
echo   [3] Exit
echo.
set /p choice="Enter your choice (1/2/3): "

if "%choice%"=="1" goto START
if "%choice%"=="2" goto STOP
if "%choice%"=="3" exit
goto MENU

:START
cls
echo ================================
echo      Starting Your App...
echo ================================
echo.

taskkill /f /im node.exe >nul 2>&1

echo [1/2] Starting Backend...
start /min cmd /k "title BACKEND && cd /d "%~dp0backend" && npm install && node index.js"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend...
start /min cmd /k "title FRONTEND && cd /d "%~dp0frontent" && npm install && npm run dev"

echo.
echo Waiting for app to be ready...
timeout /t 8 /nobreak >nul

start http://localhost:5173

echo.
echo ================================
echo  App is running! 
echo  Come back here to Stop it.
echo ================================
echo.
pause
goto MENU

:STOP
cls
echo ================================
echo      Stopping Your App...
echo ================================
echo.
taskkill /f /im node.exe >nul 2>&1
echo App stopped successfully!
echo.
pause
goto MENU