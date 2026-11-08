@echo off
setlocal

set SCRIPT_DIR=%~dp0

echo --- GitBucket Installer ---
echo.

:: Create the watch folder
echo Creating watch folder C:\GitCheckin...
mkdir "C:\GitCheckin" 2>nul

:: Put a "GitCheckin" shortcut on the Desktop so the drop folder is always one click away
echo Adding GitCheckin shortcut to your Desktop...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\GitCheckin.lnk'); $s.TargetPath='C:\GitCheckin'; $s.Description='Right-drag a project folder here to commit it'; $s.Save()"

:: Install npm dependencies
echo Installing dependencies...
cd /d "%SCRIPT_DIR%"
call npm install --omit=dev

:: Register scheduled task to run on user login (silent, no window)
echo Registering startup task...
schtasks /create /tn "GitBucket Watcher" /tr "wscript.exe \"%SCRIPT_DIR%launcher.vbs\"" /sc onlogon /rl highest /f >nul

:: Start it now without needing a reboot
echo Starting GitBucket...
schtasks /run /tn "GitBucket Watcher" >nul

echo.
echo Done! GitBucket is running in the background.
echo.
echo  Watch folder : C:\GitCheckin
echo  Log file     : %SCRIPT_DIR%gitbucket.log
echo.
echo HOW TO USE:
echo   In Windows Explorer, right-drag any project folder into C:\GitCheckin
echo   Select "Create shortcut here" from the menu that appears.
echo   GitBucket will git init (if needed) and commit all changes automatically.
echo.
echo Opening C:\GitCheckin now - this is your drop folder.
start "" explorer "C:\GitCheckin"
pause
