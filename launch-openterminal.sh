#!/usr/bin/env bash
# Starts OpenTerminal (if it isn't already running) and opens it in the browser.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
PORT=3001
URL="http://localhost:$PORT"

up() { curl -s -o /dev/null -m 2 "$URL"; }

if ! up; then
  if ss -ltn | grep -q ":$PORT "; then
    notify-send "OpenTerminal" "פורט $PORT תפוס על ידי תוכנה אחרת. עצור אותה ונסה שוב." 2>/dev/null
    exit 1
  fi
  PORT=$PORT nohup npm run dev > /tmp/openterminal.log 2>&1 &
  for _ in $(seq 1 60); do up && break; sleep 1; done
fi
xdg-open "$URL" >/dev/null 2>&1
