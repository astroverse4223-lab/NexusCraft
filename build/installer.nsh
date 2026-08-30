; Registers the nexuscraft:// scheme at install time.
;
; electron-builder's `protocols:` option is only implemented for macOS, the
; Windows Store target and Linux — the NSIS target ignores it entirely. The app
; also claims the scheme itself on every start (setAsDefaultProtocolClient), so
; without this it works, but only after the launcher has been run once. Doing it
; here means an "Install with NexusCraft" link works straight after installing.
;
; SHCTX follows the installer's own scope, so a per-user install writes to
; HKCU and a per-machine one to HKLM, matching where everything else went.

!macro customInstall
  DetailPrint "Registering nexuscraft:// links"

  WriteRegStr SHCTX "Software\Classes\nexuscraft" "" "URL:NexusCraft Protocol"
  WriteRegStr SHCTX "Software\Classes\nexuscraft" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\nexuscraft\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\nexuscraft\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; Leaving a handler pointing at a deleted executable turns every link into an
  ; error dialog, so the whole key goes with the app.
  DeleteRegKey SHCTX "Software\Classes\nexuscraft"
!macroend
