#!/usr/bin/env python3
from typing import Optional
import json
import sys
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "mydashboard/2.0"})
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


def icon_from_code(code) -> str:
    try:
        code = int(code)
    except Exception:
        return "⛅"

    mapping = {
        26: "☁️",
        27: "☁️",
        28: "☁️",
        29: "⛅",
        30: "🌤️",
        31: "🌙",
        32: "☀️",
        33: "🌙",
        34: "🌤️",
        45: "🌧️",
        46: "🌨️",
        47: "⛈️",
    }
    return mapping.get(code, "⛅")


def derive_hourly_url(wu_cfg: dict) -> str:
    hourly_url = str(wu_cfg.get("hourly_url", "")).strip()
    if hourly_url:
        return hourly_url

    forecast_url = str(wu_cfg.get("forecast_url", "")).strip()
    if not forecast_url:
        return ""

    replacements = [
        ("/daily/5day", "/hourly/2day"),
        ("/daily/7day", "/hourly/2day"),
        ("/daily/10day", "/hourly/2day"),
        ("/daily/15day", "/hourly/2day"),
    ]
    for old, new in replacements:
        if old in forecast_url:
            return forecast_url.replace(old, new)
    return ""


def build_parts_from_daypart(dp: dict) -> list:
    names = dp.get("daypartName", []) or []
    icon_codes = dp.get("iconCode", []) or []
    precip = dp.get("precipChance", []) or []
    temperatures = dp.get("temperature", []) or []
    narratives = dp.get("narrative", []) or []
    wind_speeds = dp.get("windSpeed", []) or []

    parts = []
    for i, raw_name in enumerate(names):
        if raw_name in (None, ""):
            continue
        parts.append({
            "name": raw_name,
            "start": None,
            "end": None,
            "icon": icon_from_code(icon_codes[i] if i < len(icon_codes) else None),
            "summary": narratives[i] if i < len(narratives) else None,
            "temp": safe_float(temperatures[i] if i < len(temperatures) else None),
            "tempMin": None,
            "tempMax": None,
            "pop": safe_int(precip[i] if i < len(precip) else None),
            "windKmh": safe_float(wind_speeds[i] if i < len(wind_speeds) else None),
        })
    return parts


def transform(daily_payload: dict, hourly_payload: Optional[dict], days: int = 5, hourly_message: Optional[str] = None) -> dict:
    provider_id = "wu"
    provider_name = "Weather Underground"
    out = base_payload(provider_id, provider_name)

    day_names = daily_payload.get("dayOfWeek", []) or []
    valid_dates = daily_payload.get("validTimeLocal", []) or []
    tmin = daily_payload.get("temperatureMin", []) or []
    tmax = daily_payload.get("temperatureMax", []) or []
    narratives = daily_payload.get("narrative", []) or []
    sunrise = daily_payload.get("sunriseTimeLocal", []) or []
    sunset = daily_payload.get("sunsetTimeLocal", []) or []
    moonrise = daily_payload.get("moonriseTimeLocal", []) or []
    moonset = daily_payload.get("moonsetTimeLocal", []) or []
    moon_phase = daily_payload.get("moonPhase", []) or []
    moon_phase_code = daily_payload.get("moonPhaseCode", []) or []
    daypart_list = daily_payload.get("daypart", []) or []
    dp = daypart_list[0] if daypart_list and isinstance(daypart_list[0], dict) else {}

    weekdays_map = {
        "lunedì": "Lun",
        "martedì": "Mar",
        "mercoledì": "Mer",
        "giovedì": "Gio",
        "venerdì": "Ven",
        "sabato": "Sab",
        "domenica": "Dom",
        "monday": "Lun",
        "tuesday": "Mar",
        "wednesday": "Mer",
        "thursday": "Gio",
        "friday": "Ven",
        "saturday": "Sab",
        "sunday": "Dom",
    }

    dp_icons = dp.get("iconCode", []) or []
    dp_precip = dp.get("precipChance", []) or []
    dp_narratives = dp.get("narrative", []) or []

    daily = []
    max_days = min(days, len(day_names) if day_names else days)
    for i in range(max_days):
        name = str(day_names[i]).strip().lower() if i < len(day_names) else ""
        icon_idx = (i * 2) + 2
        summary_idx = (i * 2) + 2
        date_str = valid_dates[i][:10] if i < len(valid_dates) and valid_dates[i] else None
        daily.append({
            "date": date_str,
            "dayLabel": weekdays_map.get(name, str(day_names[i])[:3] if i < len(day_names) else None),
            "icon": icon_from_code(dp_icons[icon_idx] if icon_idx < len(dp_icons) else None),
            "summary": narratives[i] if i < len(narratives) else (dp_narratives[summary_idx] if summary_idx < len(dp_narratives) else None),
            "tempMin": safe_float(tmin[i] if i < len(tmin) else None),
            "tempMax": safe_float(tmax[i] if i < len(tmax) else None),
            "pop": safe_int(dp_precip[icon_idx] if icon_idx < len(dp_precip) else None),
            "rainMm": None,
            "windKmh": None,
            "humidity": None,
            "sunrise": sunrise[i][11:16] if i < len(sunrise) and sunrise[i] else None,
            "sunset": sunset[i][11:16] if i < len(sunset) and sunset[i] else None,
        })

    hourly = []
    if hourly_payload:
        times = hourly_payload.get("validTimeLocal", []) or []
        temps = hourly_payload.get("temperature", []) or []
        feels = hourly_payload.get("temperatureHeatIndex", []) or hourly_payload.get("temperatureDewPoint", []) or []
        icons = hourly_payload.get("iconCode", []) or []
        pops = hourly_payload.get("precipChance", []) or []
        narratives_h = hourly_payload.get("narrative", []) or []
        wind_speed = hourly_payload.get("windSpeed", []) or []
        wind_dir = hourly_payload.get("windDirectionCardinal", []) or []
        humidity = hourly_payload.get("relativeHumidity", []) or []
        pressure = hourly_payload.get("pressureMeanSeaLevel", []) or []
        uv = hourly_payload.get("uvIndex", []) or []

        for i in range(min(24, len(times))):
            dt = times[i]
            hourly.append({
                "time": dt[11:16] if dt and len(dt) >= 16 else None,
                "dateTime": dt,
                "temp": safe_float(temps[i] if i < len(temps) else None),
                "feelsLike": safe_float(feels[i] if i < len(feels) else None),
                "icon": icon_from_code(icons[i] if i < len(icons) else None),
                "summary": narratives_h[i] if i < len(narratives_h) else None,
                "pop": safe_int(pops[i] if i < len(pops) else None),
                "rainMm": None,
                "windKmh": safe_float(wind_speed[i] if i < len(wind_speed) else None),
                "windDir": wind_dir[i] if i < len(wind_dir) else None,
                "humidity": safe_int(humidity[i] if i < len(humidity) else None),
                "pressure": safe_float(pressure[i] if i < len(pressure) else None),
                "uv": safe_int(uv[i] if i < len(uv) else None),
            })

    parts = build_parts_from_daypart(dp)

    summary_text = None
    summary_icon = None
    if hourly:
        summary_text = hourly[0].get("summary")
        summary_icon = hourly[0].get("icon")
    elif parts:
        summary_text = parts[0].get("summary")
        summary_icon = parts[0].get("icon")
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
        "astronomy": {
            "sunrise": sunrise[0][11:16] if sunrise and sunrise[0] else None,
            "sunset": sunset[0][11:16] if sunset and sunset[0] else None,
            "moonrise": moonrise[0][11:16] if moonrise and moonrise[0] else None,
            "moonset": moonset[0][11:16] if moonset and moonset[0] else None,
            "moonPhase": moon_phase[0] if moon_phase else None,
            "moonPhaseCode": moon_phase_code[0] if moon_phase_code else None,
        },
    })

    has_daily = bool(daily)
    has_parts = bool(parts)
    has_hourly = bool(hourly)
    has_any = bool(has_daily or has_parts or has_hourly)

    message = None
    if not has_any:
        message = "Provider non disponibile"
    elif hourly_message:
        message = hourly_message

    out["status"].update({
        "ok": has_any,
        "partial": not (has_hourly and has_daily and has_parts),
        "stale": False,
        "hasHourly": has_hourly,
        "hasParts": has_parts,
        "hasDaily": has_daily,
        "message": message,
        "lastSuccess": out["updated"] if has_any else None,
    })
    return out


def main() -> int:
    provider_id = "wu"
    provider_name = "Weather Underground"
    try:
        cfg = load_config()
        wu_cfg = cfg.get("weatherunderground", {})
        enabled = bool(wu_cfg.get("enabled", False))
        forecast_url = str(wu_cfg.get("forecast_url", "")).strip()
        hourly_url = derive_hourly_url(wu_cfg)
        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "forecast-wu.json"
        days = int(cfg.get("ui", {}).get("forecast_days", 5))

        if not enabled or not forecast_url:
            disabled = base_payload(provider_id, provider_name)
            disabled["status"].update({
                "ok": False,
                "message": "Provider non configurato",
            })
            write_json(output_path, disabled)
            print("WU non configurato, scritto file vuoto strutturato")
            return 0

        daily_payload = fetch_json(forecast_url)

        hourly_payload = None
        hourly_message = None
        if hourly_url:
            try:
                hourly_payload = fetch_json(hourly_url)
            except Exception as hourly_error:
                hourly_message = "Hourly WU non disponibile per il piano/API corrente"

        data = transform(daily_payload, hourly_payload, days=days, hourly_message=hourly_message)
        write_json(output_path, data)
        print(f"OK scritto {output_path}")
        return 0
    except Exception as e:
        try:
            cfg = load_config()
            public_data_dir = Path(cfg["paths"]["public_data_dir"])
            output_path = public_data_dir / "forecast-wu.json"
        except Exception:
            output_path = Path("forecast-wu.json")
        previous = read_json_file(output_path)
        fallback = merge_stale(previous, provider_id, provider_name, f"Aggiornamento WU fallito: {e}")
        write_json(output_path, fallback)
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
