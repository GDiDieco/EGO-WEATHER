#!/usr/bin/env python3
from typing import Optional
import json
import sys
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"

ICON_MAP = {
    "clear": "☀️",
    "pcloudy": "🌤️",
    "mcloudy": "⛅",
    "cloudy": "☁️",
    "rain": "🌧️",
    "showers": "🌦️",
    "tstorm": "⛈️",
    "snow": "❄️",
    "fog": "🌫️",
    "wintrymix": "🌨️",
}


# -----------------------------
# Helpers
# -----------------------------
def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def icon_from_xweather(icon_name: str) -> str:
    if not icon_name:
        return "⛅"
    name = str(icon_name).lower()
    for key, emoji in ICON_MAP.items():
        if key in name:
            return emoji
    return "⛅"


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "weewx-dashboard/2.0"})
    with urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def safe_float(v, default=None):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


def safe_int(v, default=None):
    try:
        if v is None or v == "":
            return default
        return int(round(float(v)))
    except Exception:
        return default


def parse_iso(iso_str: str):
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
    except Exception:
        return None


def read_json_file(path: Path) -> Optional[dict]:
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def base_payload(provider_id: str, provider_name: str) -> dict:
    return {
        "provider": {
            "id": provider_id,
            "name": provider_name,
        },
        "status": {
            "ok": False,
            "partial": False,
            "stale": False,
            "hasHourly": False,
            "hasParts": False,
            "hasDaily": False,
            "message": None,
            "lastSuccess": None,
        },
        "updated": None,
        "location": {},
        "summary": {
            "text": None,
            "icon": None,
            "tempTrend": None,
        },
        "hourly": [],
        "parts": [],
        "daily": [],
        "astronomy": {},
    }


def merge_stale(existing: Optional[dict], provider_id: str, provider_name: str, message: str) -> dict:
    if existing and isinstance(existing, dict):
        out = deepcopy(existing)
        out.setdefault("provider", {"id": provider_id, "name": provider_name})
        out.setdefault("status", {})
        out["status"].update({
            "ok": True,
            "partial": bool(out.get("status", {}).get("partial", False)),
            "stale": True,
            "hasHourly": bool(out.get("hourly")),
            "hasParts": bool(out.get("parts")),
            "hasDaily": bool(out.get("daily")),
            "message": message,
            "lastSuccess": out.get("updated") or out.get("status", {}).get("lastSuccess"),
        })
        return out

    out = base_payload(provider_id, provider_name)
    out["status"].update({
        "ok": False,
        "partial": False,
        "stale": False,
        "message": message,
    })
    return out


def build_urls(cfg: dict) -> tuple[str, str]:
    lat = cfg["station"]["latitude"]
    lon = cfg["station"]["longitude"]
    days = int(cfg.get("ui", {}).get("forecast_days", 5))
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]

    common = {
        "client_id": client_id,
        "client_secret": client_secret,
        "format": "json",
    }

    hourly_fields = ",".join([
        "periods.dateTimeISO",
        "periods.tempC",
        "periods.feelslikeC",
        "periods.pop",
        "periods.weatherPrimary",
        "periods.icon",
        "periods.windSpeedKPH",
        "periods.windDir",
        "periods.humidity",
        "periods.pressureMB",
        "profile.tz",
    ])
    daily_fields = ",".join([
        "periods.dateTimeISO",
        "periods.minTempC",
        "periods.maxTempC",
        "periods.pop",
        "periods.weatherPrimary",
        "periods.icon",
        "periods.windSpeedKPH",
        "periods.windDir",
        "periods.humidity",
        "profile.tz",
    ])

    hourly_params = dict(common)
    hourly_params.update({"filter": "1hr", "limit": 24, "fields": hourly_fields})

    daily_params = dict(common)
    daily_params.update({"filter": f"{days}day", "fields": daily_fields})

    base = f"https://data.api.xweather.com/forecasts/{lat},{lon}"
    return f"{base}?{urlencode(hourly_params)}", f"{base}?{urlencode(daily_params)}"


def build_parts_from_hourly(hourly: list[dict]) -> list[dict]:
    windows = [
        ("Mattina", 6, 11),
        ("Pomeriggio", 12, 17),
        ("Sera", 18, 23),
        ("Notte", 0, 5),
    ]
    out = []
    for name, start_h, end_h in windows:
        bucket = []
        for h in hourly:
            t = h.get("time")
            if not t or len(t) < 2:
                continue
            try:
                hour = int(t[:2])
            except Exception:
                continue
            if start_h <= end_h:
                match = start_h <= hour <= end_h
            else:
                match = hour >= start_h or hour <= end_h
            if match:
                bucket.append(h)
        if not bucket:
            continue
        temps = [x.get("temp") for x in bucket if x.get("temp") is not None]
        pops = [x.get("pop") for x in bucket if x.get("pop") is not None]
        winds = [x.get("windKmh") for x in bucket if x.get("windKmh") is not None]
        rep = bucket[len(bucket) // 2]
        out.append({
            "name": name,
            "start": f"{start_h:02d}:00",
            "end": f"{end_h:02d}:59",
            "icon": rep.get("icon"),
            "summary": rep.get("summary"),
            "tempMin": min(temps) if temps else None,
            "tempMax": max(temps) if temps else None,
            "pop": max(pops) if pops else None,
            "windKmh": round(sum(winds) / len(winds), 1) if winds else None,
        })
    return out


def transform(hourly_payload: dict, daily_payload: dict) -> dict:
    provider_id = "pws"
    provider_name = "PWSWeather / Xweather"
    out = base_payload(provider_id, provider_name)

    hr_response = (hourly_payload or {}).get("response", [])
    dy_response = (daily_payload or {}).get("response", [])
    hr_item = hr_response[0] if hr_response else {}
    dy_item = dy_response[0] if dy_response else {}
    hr_periods = hr_item.get("periods", []) or []
    dy_periods = dy_item.get("periods", []) or []

    tz_name = None
    profile = hr_item.get("profile") or dy_item.get("profile") or {}
    if isinstance(profile, dict):
        tz_name = profile.get("tz")

    out["location"] = {"tz": tz_name}

    hourly = []
    for p in hr_periods[:24]:
        iso = p.get("dateTimeISO")
        dt = parse_iso(iso)
        hourly.append({
            "time": dt.strftime("%H:%M") if dt else None,
            "dateTime": iso,
            "temp": safe_float(p.get("tempC")),
            "feelsLike": safe_float(p.get("feelslikeC")),
            "icon": icon_from_xweather(p.get("icon")),
            "summary": p.get("weatherPrimary"),
            "pop": safe_int(p.get("pop")),
            "rainMm": None,
            "windKmh": safe_float(p.get("windSpeedKPH")),
            "windDir": p.get("windDir"),
            "humidity": safe_int(p.get("humidity")),
            "pressure": safe_float(p.get("pressureMB")),
            "uv": None,
        })

    weekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]
    daily = []
    for p in dy_periods:
        iso = p.get("dateTimeISO")
        dt = parse_iso(iso)
        daily.append({
            "date": iso[:10] if iso else None,
            "dayLabel": weekdays[dt.weekday()] if dt else None,
            "icon": icon_from_xweather(p.get("icon")),
            "summary": p.get("weatherPrimary"),
            "tempMin": safe_float(p.get("minTempC")),
            "tempMax": safe_float(p.get("maxTempC")),
            "pop": safe_int(p.get("pop")),
            "rainMm": None,
            "windKmh": None,
            "humidity": None,
            "sunrise": None,
            "sunset": None,
            "windKmh": safe_float(p.get("windSpeedKPH")),
            "windDir": p.get("windDir"),
            "humidity": safe_int(p.get("humidity")),
        })

    parts = build_parts_from_hourly(hourly)

    summary_text = None
    summary_icon = None
    if hourly:
        summary_text = hourly[0].get("summary")
        summary_icon = hourly[0].get("icon")
    elif daily:
        summary_text = daily[0].get("summary")
        summary_icon = daily[0].get("icon")

    out.update({
        "updated": now_iso(),
        "summary": {
            "text": summary_text,
            "icon": summary_icon,
            "tempTrend": None,
        },
        "hourly": hourly,
        "parts": parts,
        "daily": daily,
    })

    out["status"].update({
        "ok": bool(hourly or daily),
        "partial": not (bool(hourly) and bool(daily) and bool(parts)),
        "stale": False,
        "hasHourly": bool(hourly),
        "hasParts": bool(parts),
        "hasDaily": bool(daily),
        "message": None if (hourly or daily) else "Provider non disponibile",
        "lastSuccess": out["updated"] if (hourly or daily) else None,
    })
    return out


def main() -> int:
    provider_id = "pws"
    provider_name = "PWSWeather / Xweather"
    try:
        cfg = load_config()
        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "forecast-pws.json"
        previous = read_json_file(output_path)

        hourly_url, daily_url = build_urls(cfg)
        hourly_payload = fetch_json(hourly_url)
        daily_payload = fetch_json(daily_url)
        output = transform(hourly_payload, daily_payload)
        write_json(output_path, output)
        print(f"OK scritto {output_path}")
        return 0
    except Exception as e:
        try:
            cfg = load_config()
            public_data_dir = Path(cfg["paths"]["public_data_dir"])
            output_path = public_data_dir / "forecast-pws.json"
        except Exception:
            output_path = Path("forecast-pws.json")
        previous = read_json_file(output_path)
        fallback = merge_stale(previous, provider_id, provider_name, f"Aggiornamento PWS fallito: {e}")
        write_json(output_path, fallback)
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
