Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
currentDir = "C:\\Users\\Pc 4\\.gemini\\antigravity\\scratch\\Softech game club\\NetCafeServer"
WshShell.CurrentDirectory = currentDir
WshShell.Run "cmd.exe /c """ & currentDir & "\apply_server_update.bat""", 0, False
