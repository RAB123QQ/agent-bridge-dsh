' launch-dsh.vbs
'
' Hidden-window wrapper around launch-dsh.ps1, so a desktop shortcut can
' start DSH (and the agentbridge-dsh bridge, if configured) without ever
' flashing a console window. Point a shortcut's target at this file.
'
' All configuration lives in launch-dsh.ps1 (parameters / environment
' variables); this file only launches PowerShell hidden and forwards any
' arguments given to it, unchanged, to the script.
'
' Optional: set environment variables before launching this file (e.g. via
' a wrapping .cmd, Task Scheduler action, or the Windows environment editor)
' to point at your own dsh / agentbridge-dsh setup:
'   DSH_PORT, DSH_WORKDIR, DSH_HOME, DSH_NODE_EXE, DSH_CHROME_EXE,
'   DSH_CHROME_APP_ID, AGENTBRIDGE_DSH_DIR, AGENTBRIDGE_DSH_PAIR,
'   AGENTBRIDGE_DSH_MCP_PORT, AGENTBRIDGE_DSH_CONTROL_PORT
' See launch-dsh.ps1's header comment for what each one does.

Option Explicit

Dim fso, shell, scriptDir, psScript, cmd, extraArgs, i

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = scriptDir & "\launch-dsh.ps1"

If Not fso.FileExists(psScript) Then
    MsgBox "launch-dsh.ps1 not found next to launch-dsh.vbs:" & vbCrLf & psScript, vbCritical, "DSH launcher"
    WScript.Quit 1
End If

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
    extraArgs = extraArgs & " """ & WScript.Arguments(i) & """"
Next

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """" & extraArgs

' 0 = hidden window, False = do not wait for it to exit (launcher backgrounds itself)
shell.Run cmd, 0, False
