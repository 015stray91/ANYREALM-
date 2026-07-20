#!/bin/bash
xset s off
xset s noblank
xset -dpms

# Spin up local Bun background server daemon mapping port 3000
cd /C/ANYREALM-
bun run dev &
sleep 2

# Initialize single-purpose workspace display tracks
firefox-nightly --kiosk --new-window http://localhost:3000 &
code --user-data-dir=/etc/kiosk/vscode-profile --extensions-dir=/etc/kiosk/vscode-extensions --no-sandbox --kiosk /C/ANYREALM-
