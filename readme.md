# 🌦️ RPI Weather Dashboard

A modern and responsive weather dashboard designed for Raspberry Pi, powered by **WeeWX** and external weather APIs (e.g. Xweather).

This project provides a clean and informative interface for real-time conditions, forecasts, nearby locations, and environmental data.

---

## 📸 Preview

![Dashboard](screenshots/dashboard.png)

---

## 🚀 Features

* 🌡️ Real-time weather conditions
* ⏱️ Hourly forecast visualization
* 📍 Nearby locations comparison (temperature, wind, humidity)
* 🌫️ Air Quality Index (AQI)
* ☀️ UV Index
* 🌙 Astronomy data (moon phases, sunrise/sunset)
* 🛰️ Radar integration
* 📊 Historical data support (via WeeWX)
* 📱 Responsive UI (tablet & desktop friendly)

---

## 🧱 Tech Stack

* **Raspberry Pi**
* **WeeWX** (weather station data)
* **Python** (data fetching scripts)
* **Vanilla JavaScript**
* **HTML / CSS**
* External APIs (e.g. Xweather)

---

## 📦 Project Structure

```
rpi-weather-dashboard/
├── dashboard/          # Frontend (HTML, CSS, JS)
├── scripts/            # Python data fetch scripts
├── config/             # Configuration files
├── screenshots/        # UI preview images
├── docs/               # Documentation
├── requirements.txt
└── README.md
```

---

## ⚙️ Installation

### 1. Clone repository

```bash
git clone https://github.com/your-username/rpi-weather-dashboard.git
cd rpi-weather-dashboard
```

---

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

---

### 3. Configure the dashboard

Edit configuration files inside:

```
config/
```

Typical configuration includes:

* Coordinates (latitude / longitude)
* Nearby locations list
* API provider settings
* Update intervals

---

### 4. Run data fetch scripts

Example:

```bash
python scripts/fetch_nearby_places.py
```

You can schedule scripts using `cron` for periodic updates.

---

### 5. Open the dashboard

Serve the `dashboard/` folder via:

* Nginx / Apache
  or
* Simple HTTP server:

```bash
cd dashboard
python -m http.server 8080
```

Then open:

```
http://<raspberry-ip>:8080
```

---

## 📍 Nearby Locations

The dashboard supports multiple nearby locations (up to 6 by default), showing:

* Temperature
* Weather conditions
* Wind speed
* Humidity
* Distance from main station

Locations are defined in the configuration and resolved via API.

---

## 📊 Data Sources

* Local weather station via **WeeWX**
* External APIs (e.g. Xweather) for:

  * Forecast
  * Nearby conditions
  * Radar layers

---

## 🖼️ Screenshots

Add more screenshots here:

```
screenshots/
```

Suggested:

* Full dashboard
* Nearby tile
* Mobile view

---

## 🛠️ Customization

You can easily customize:

* UI styles (CSS)
* Layout of tiles
* Number of nearby locations
* Data sources / APIs
* Units (metric / imperial)

---

## 📌 Notes

* Designed primarily for **Raspberry Pi dashboards**
* Works well on tablets (e.g. iPad wall display)
* Optimized for local network usage

---

## 🤝 Contributing

Contributions are welcome!

Feel free to:

* Open issues
* Suggest improvements
* Submit pull requests

---

## 📄 License

MIT License
