@echo off
echo --- GitBucket Uninstaller ---
echo.
echo Stopping GitBucket...
schtasks /end /tn "GitBucket Watcher" 2>nul
schtasks /delete /tn "GitBucket Watcher" /f 2>nul
echo GitBucket removed. The C:\GitCheckin folder has been left in place.
echo.
pause
