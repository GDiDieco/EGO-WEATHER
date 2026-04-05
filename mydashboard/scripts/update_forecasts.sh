#!/bin/bash
/usr/bin/python3 /home/pi/mydashboard/scripts/fetch_forecast_pws.py >> /home/pi/mydashboard/logs/fetch_forecast_pws.log 2>&1
/usr/bin/python3 /home/pi/mydashboard/scripts/fetch_forecast_wu.py >> /home/pi/mydashboard/logs/fetch_forecast_wu.log 2>&1
/usr/bin/python3 /home/pi/mydashboard/scripts/build_forecast_compare.py >> /home/pi/mydashboard/logs/build_forecast_compare.log 2>&1
