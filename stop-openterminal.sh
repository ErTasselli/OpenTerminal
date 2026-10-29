#!/usr/bin/env bash
# Stops OpenTerminal's API and web processes.
pkill -f "tsx watch src/index.ts"; pkill -f "next dev"; pkill -f "concurrently -n api,web"
notify-send "OpenTerminal" "נעצר" 2>/dev/null
