' Launches service.js via node with no visible console window.
Dim objShell, strScript
Set objShell = CreateObject("WScript.Shell")
strScript = Replace(WScript.ScriptFullName, "launcher.vbs", "service.js")
objShell.Run "node """ & strScript & """", 0, False
Set objShell = Nothing
