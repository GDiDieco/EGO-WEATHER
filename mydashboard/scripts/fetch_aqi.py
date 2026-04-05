#!/usr/bin/env python3
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


PM25_BREAKPOINTS = [
    (0.0, 9.0, 0, 50, "Buona", "#22c55e"),
    (9.1, 35.4, 51, 100, "Moderata", "#eab308"),
    (35.5, 55.4, 101, 150, "Sensibili", "#f97316"),
    (55.5, 125.4, 151, 200, "Scarsa", "#ef4444"),
    (125.5, 225.4, 201, 300, "Molto scarsa", "#a855f7"),
    (225.5, 325.4, 301, 500, "Pericolosa", "#7f1d1d"),
]

PM10_BREAKPOINTS = [
    (0, 54, 0, 50, "Buona", "#22c55e"),
    (55, 154, 51, 100, "Moderata", "#eab308"),
    (155, 254, 101, 150, "Sensibili", "#f97316"),
    (255, 354, 151, 200, "Scarsa", "#ef4444"),
    (355, 424, 201, 300, "Molto scarsa", "#a855f7"),
    (425, 604, 301, 500, "Pericolosa", "#7f1d1d"),
]


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def clean_num(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s or s.upper() in ("N/A", "NONE", "NULL"):
        return None
    s = s.replace(",", ".")
    try:
        return float(s.split()[0])
    except Exception:
        return None


def compute_subindex(concentration, breakpoints):
    if concentration is None:
        return None

    for c_low, c_high, i_low, i_high, label, color in breakpoints:
        if c_low <= concentration <= c_high:
            aqi = ((i_high - i_low) / (c_high - c_low)) * (concentration - c_low) + i_low
            return {
                "aqi": int(round(aqi)),
                "category": label,
                "color": color,
                "concentration": concentration
            }

    if concentration > breakpoints[-1][1]:
        c_low, c_high, i_low, i_high, label, color = breakpoints[-1]
        aqi = ((i_high - i_low) / (c_high - c_low)) * (concentration - c_low) + i_low
        return {
            "aqi": int(round(min(aqi, 500))),
            "category": label,
            "color": color,
            "concentration": concentration
        }

    return None


def load_current_json(public_data_dir: Path) -> dict:
    path = public_data_dir / "current.json"
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "mydashboard/1.0"})
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_xweather_url(cfg: dict) -> str:
    lat = cfg["station"]["latitude"]
    lon = cfg["station"]["longitude"]
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]

    params = {
        "client_id": client_id,
        "client_secret": client_secret,
        "format": "json"
    }
    return f"https://data.api.xweather.com/airquality/{lat},{lon}?{urlencode(params)}"


def parse_xweather_airquality(payload: dict) -> dict:
    response = payload.get("response", [])
    if not response:
        return {
            "aqi": None,
            "category": "N/D",
            "color": "#64748b",
            "dominantPollutant": "N/D",
            "source": "Xweather"
        }

    item = response[0]

    period = None
    periods = item.get("periods")
    if isinstance(periods, list) and periods:
        period = periods[0]
    elif isinstance(item, dict):
        period = item

    if not period:
        return {
            "aqi": None,
            "category": "N/D",
            "color": "#64748b",
            "dominantPollutant": "N/D",
            "source": "Xweather"
        }

    # alcuni payload usano "aqi", altri possono avere campi nested diversi
    aqi = period.get("aqi")
    category = period.get("category") or period.get("aqiCategory") or "N/D"
    dominant = period.get("dominant") or period.get("primaryPollutant") or "N/D"
    color = (
        period.get("color")
        or period.get("categoryColor")
        or "#64748b"
    )

    return {
        "aqi": aqi,
        "category": category,
        "color": color,
        "dominantPollutant": dominant,
        "source": "Xweather"
    }


def compare_local_vs_area(local_aqi, area_aqi):
    if local_aqi is None or area_aqi is None:
        return "confronto non disponibile"
    diff = local_aqi - area_aqi
    if diff <= -10:
        return "migliore dell'area"
    if diff >= 10:
        return "peggiore dell'area"
    return "simile all'area"


def main() -> int:
    try:
        cfg = load_config()
        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "aqi.json"

        current = load_current_json(public_data_dir)

        pm25 = clean_num(current.get("pm2_5"))
        pm10 = clean_num(current.get("pm10_0"))
        pm1 = clean_num(current.get("pm1_0"))

        pm25_idx = compute_subindex(pm25, PM25_BREAKPOINTS)
        pm10_idx = compute_subindex(pm10, PM10_BREAKPOINTS)

        local_candidates = [x for x in [pm25_idx, pm10_idx] if x]
        if local_candidates:
            local_final = max(local_candidates, key=lambda x: x["aqi"])
        else:
            local_final = {
                "aqi": None,
                "category": "N/D",
                "color": "#64748b"
            }

        area_data = {
            "aqi": None,
            "category": "N/D",
            "color": "#64748b",
            "dominantPollutant": "N/D",
            "source": "Xweather"
        }

        if cfg.get("aqi", {}).get("xweather_enabled", True):
            try:
                url = build_xweather_url(cfg)
                payload = fetch_json(url)
                area_data = parse_xweather_airquality(payload)
            except Exception:
                pass

        result = {
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "local": {
                "aqi": local_final["aqi"],
                "category": local_final["category"],
                "color": local_final["color"],
                "pm1_0": pm1,
                "pm2_5": pm25,
                "pm10_0": pm10,
                "pm25_aqi": pm25_idx["aqi"] if pm25_idx else None,
                "pm10_aqi": pm10_idx["aqi"] if pm10_idx else None
            },
            "area": area_data,
            "comparison": compare_local_vs_area(local_final["aqi"], area_data.get("aqi"))
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        print(f"OK scritto {output_path}")
        return 0

    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
