Option Explicit
' OrangeDisk launcher: starts the local server silently, then the app window.
Dim fso, sh, appDir, node, server
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
node = "D:\xz\dsh-node\node.exe"
If Not fso.FileExists(node) Then node = fso.GetParentFolderName(appDir) & "\node.exe"
If Not fso.FileExists(node) Then
  MsgBox "Node.js not found." & vbCrLf & "Please install Node.js or edit this script.", 16, "OrangeDisk"
  WScript.Quit 1
End If

server = appDir & "\server.mjs"
sh.CurrentDirectory = appDir
sh.Run """" & node & """ """ & server & """", 0, False
