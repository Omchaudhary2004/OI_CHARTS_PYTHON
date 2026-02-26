@echo off
title OI Chart Launcher
cls

:: Route to pyloop restart if called internally with 'backend' argument
if "%1"=="backend" goto pyloop

:MENU
echo.
echo ====================================
echo        OI CHART LAUNCHER
echo ====================================
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
echo ====================================
echo       Starting OI Chart...
echo ====================================
echo.

:: FIX: check .venv exists before attempting to start — avoids silent crash loop
if not exist "%~dp0pybackend\.venv\Scripts\activate.bat" (
    echo.
    echo  ERROR: Python virtual environment not found!
    echo  Expected: %~dp0pybackend\.venv\
    echo.
    echo  To create it, run in the pybackend folder:
    echo    python -m venv .venv
    echo    .venv\Scripts\activate
    echo    pip install -r requirements.txt
    echo.
    pause
    goto MENU
)

:: Kill any existing instances
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

:: FIX: kill any lingering process on port 4000 (prevents "Address already in use" crash)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000 " 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [1/2] Starting Backend (auto-restart on crash)...
:: FIX: double-quote %~f0 so spaces in path don't break the command
start "BACKEND" cmd /k ""%~f0" backend"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend...
:: FIX: use start /d for working dir (avoids quoting issues with cd on spaced paths)
:: FIX: use npm.cmd not npm to bypass PowerShell execution policy
start "FRONTEND" /d "%~dp0frontent" cmd /k "npm.cmd install && npm.cmd run dev"

echo.
echo Waiting for app to be ready...
timeout /t 8 /nobreak >nul

start http://localhost:5173

echo.
echo ====================================
echo  App is running in background!
echo  Press any key to return to menu.
echo  NOTE: Keep terminal windows open.
echo  Close them = data collection stops.
echo ====================================
echo.
pause
goto MENU

:STOP
cls
echo ====================================
echo       Stopping OI Chart...
echo ====================================
echo.

taskkill /f /fi "WINDOWTITLE eq BACKEND" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq FRONTEND" >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo App stopped successfully!
echo.
pause
goto MENU

:pyloop
:: FIX: auto-restart loop — cd and activate venv on every restart (crash recovery)
cd /d "%~dp0pybackend"
call .venv\Scripts\activate
echo [%DATE% %TIME%] Starting Python backend...
python main.py
echo [%DATE% %TIME%] Backend exited. Restarting in 3s...
timeout /t 3 /nobreak
goto pyloop
