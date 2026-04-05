#!/bin/bash

LOCKFILE="/tmp/mydashboard-history.lock"

exec 9>"$LOCKFILE"
flock -n 9 || exit 0

run_export() {
  local script="$1"
  /usr/bin/python3 "$script" || echo "[WARN] fallito: $script"
}

run_export /home/pi/mydashboard/scripts/fetch_history_temperature.py
run_export /home/pi/mydashboard/scripts/fetch_history_wind.py
run_export /home/pi/mydashboard/scripts/fetch_history_rain.py
run_export /home/pi/mydashboard/scripts/fetch_history_pressure.py
run_export /home/pi/mydashboard/scripts/fetch_history_solar.py
run_export /home/pi/mydashboard/scripts/fetch_history_aqi.py

