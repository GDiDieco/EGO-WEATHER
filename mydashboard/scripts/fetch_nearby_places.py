#!/usr/bin/env python3
from typing import Optional
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "mydashboard/1.0"})
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def clean_num(v):
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def build_conditions_url(cfg: dict, place_query: str) -> str:
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]

    fields = ",".join([
        "place.name",
        "place.country",
        "place.state",
        "loc.lat",
        "loc.long",
        "ob.timestamp",
        "ob.tempC",
        "ob.weather",
        "ob.icon",
        "ob.windSpeedKPH",
        "ob.windDirDEG",
        "ob.pressureMB",
        "ob.humidity"
    ])

    params = {
        "client_id": client_id,
        "client_secret": client_secret,
        "p": place_query,
        "format": "json",
    }

    return f"https://data.api.xweather.com/conditions?{urlencode(params)}"


def first_non_null(*values):
    for v in values:
        if v is not None:
            return v
    return None


def parse_condition_response(payload: dict, fallback_name: str, lat0: float, lon0: float) -> Optional[dict]:
    response = payload.get("response") or []
    if not response:
        return None

    item = response[0] if isinstance(response, list) else response

    place = item.get("place", {}) or {}
    loc = item.get("loc", {}) or {}
    ob = item.get("ob", {}) or {}
    periods = item.get("periods") or []
    period0 = periods[0] if periods and isinstance(periods[0], dict) else {}

    lat = clean_num(first_non_null(
        loc.get("lat"),
        item.get("lat")
    ))
    lon = clean_num(first_non_null(
        loc.get("long"),
        loc.get("lon"),
        item.get("long"),
        item.get("lon")
    ))

    distance_km = None
    if lat is not None and lon is not None:
        distance_km = round(haversine_km(lat0, lon0, lat, lon), 1)

    return {
        "name": fallback_name,
        "country": place.get("country") or item.get("country") or "",
        "state": place.get("state") or item.get("state") or "",
        "distance_km": distance_km,
        "tempC": clean_num(first_non_null(
            ob.get("tempC"),
            item.get("tempC"),
            period0.get("tempC"),
            period0.get("avgTempC")
        )),
        "weather": first_non_null(
            ob.get("weather"),
            item.get("weather"),
            period0.get("weather"),
            period0.get("weatherPrimary")
        ),
        "icon": first_non_null(
            ob.get("icon"),
            item.get("icon"),
            period0.get("icon")
        ),
        "windKph": clean_num(first_non_null(
            ob.get("windSpeedKPH"),
            item.get("windSpeedKPH"),
            period0.get("windSpeedKPH")
        )),
        "windDirDeg": clean_num(first_non_null(
            ob.get("windDirDEG"),
            item.get("windDirDEG"),
            period0.get("windDirDEG")
        )),
        "pressureMb": clean_num(first_non_null(
            ob.get("pressureMB"),
            item.get("pressureMB"),
            period0.get("pressureMB")
        )),
        "humidity": clean_num(first_non_null(
            ob.get("humidity"),
            item.get("humidity"),
            period0.get("humidity")
        )),
        "timestamp": first_non_null(
            ob.get("timestamp"),
            item.get("timestamp"),
            period0.get("timestamp")
        ),
    }



def main() -> int:
    try:
        cfg = load_config()
        nearby_cfg = cfg.get("nearby_places", {})
        if not nearby_cfg.get("enabled", True):
            return 0

        public_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_dir / "nearby.json"

        station_lat = float(cfg["station"]["latitude"])
        station_lon = float(cfg["station"]["longitude"])

        places = nearby_cfg.get("places", [])[: int(nearby_cfg.get("max_items", 6))]
        items = []

        for place in places:
            name = place.get("name") or "Località"
            p = place.get("p")
            if not p:
                continue

            try:
                url = build_conditions_url(cfg, p)
                payload = fetch_json(url)
                parsed = parse_condition_response(payload, name, station_lat, station_lon)
                if parsed:
                    items.append(parsed)
            except Exception:
                continue

        items.sort(key=lambda x: (99999 if x["distance_km"] is None else x["distance_km"]))

        output = {
            "provider": "Xweather Conditions",
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "count": len(items),
            "places": items
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"OK scritto {output_path}")
        return 0

    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
