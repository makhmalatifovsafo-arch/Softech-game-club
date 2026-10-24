Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
currentDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

If FSO.FileExists(currentDir & "\runtime\node.exe") Then
    WshShell.Run """" & currentDir & "\runtime\node.exe"" src/server.js", 0, False
Else
    WshShell.Run "node src/server.js", 0, False
End If
