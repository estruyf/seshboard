; Added to the NSIS installer (electron-builder.yml → nsis.include).

; Switchboard registers switchboard:// links for the user when it starts (app.setAsDefaultProtocolClient), so
; uninstalling removes them. An update runs the old version's uninstaller too; the links stay then. Only a handler
; that starts this install's Switchboard.exe goes: Electron writes it as `"<exe>" "%1"`, so its command starts with a
; quote and this install's folder. One another app (or a copy run from elsewhere) registered since is left alone.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    ReadRegStr $0 HKCU "Software\Classes\switchboard\shell\open\command" ""
    StrLen $1 `"$INSTDIR\`
    StrCpy $1 $0 $1
    ; NSIS compares strings without regard to case, as Windows paths are.
    ${if} $1 == `"$INSTDIR\`
      DeleteRegKey HKCU "Software\Classes\switchboard"
    ${endIf}
    Pop $1
    Pop $0
  ${endIf}
!macroend
