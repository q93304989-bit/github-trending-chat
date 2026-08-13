' One-click launcher for GitHub Trending Chat
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js", 0, False
WScript.Sleep 2000
sh.Run "http://localhost:3000", 1, False
