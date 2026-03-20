@echo off
:: Start brosearch daemon (double-click to run)
cd /d "%~dp0\..\packages\daemon"
echo Starting brosearch daemon on port 19824...
node dist\index.js
pause
