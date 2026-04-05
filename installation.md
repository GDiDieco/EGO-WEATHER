# Installation Guide

## Requirements

* Raspberry Pi (recommended: Pi 4 or Pi 5)
* Python 3.9+
* WeeWX installed and running
* Internet connection for external APIs

---

## Setup Steps

1. Clone the repository
2. Install dependencies
3. Configure your locations and API provider
4. Run data scripts manually or via cron
5. Serve the dashboard via web server

---

## Running with Cron (example)

```bash
crontab -e
```

Add:

```bash
*/5 * * * * python /home/pi/rpi-weather-dashboard/scripts/fetch_nearby_places.py
```

---

## Troubleshooting

### No nearby data

* Check API limits
* Verify coordinates
* Ensure internet connectivity

### Dashboard not updating

* Verify script execution
* Check JSON output files

---

## Tips

* Use a reverse proxy (nginx) for clean URLs
* Enable caching for better performance
* Use a fixed IP or hostname for your Raspberry Pi
