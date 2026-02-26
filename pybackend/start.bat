@echo off
echo Installing Python dependencies...
pip install -r requirements.txt
echo.
echo Starting Python backend on port 4000...
python main.py
pause
