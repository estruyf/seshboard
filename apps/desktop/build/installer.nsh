; Added to the NSIS installer (electron-builder.yml → nsis.include).

; Seshboard registers seshboard:// links, and switchboard:// from before the rename, for the user when it starts
; (app.setAsDefaultProtocolClient), so uninstalling removes them. An update runs the old version's uninstaller too;
; the links stay then. Only a handler that starts this install's Seshboard.exe goes: Electron writes it as
; `"<exe>" "%1"`, so its command starts with a quote and this install's folder. One another app (or a copy run from
; elsewhere) registered since is left alone.
!macro removeLinkScheme SCHEME
  ReadRegStr $0 HKCU "Software\Classes\${SCHEME}\shell\open\command" ""
  StrLen $1 `"$INSTDIR\`
  StrCpy $1 $0 $1
  ; NSIS compares strings without regard to case, as Windows paths are.
  ${if} $1 == `"$INSTDIR\`
    DeleteRegKey HKCU "Software\Classes\${SCHEME}"
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    !insertmacro removeLinkScheme seshboard
    !insertmacro removeLinkScheme switchboard
    Pop $1
    Pop $0
  ${endIf}
!macroend
