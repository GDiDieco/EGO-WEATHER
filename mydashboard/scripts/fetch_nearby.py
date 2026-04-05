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


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "mydashboard/1.0"})
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def clean_num(v):
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def build_url(cfg: dict) -> str:
    lat = cfg["station"]["latitude"]
    lon = cfg["station"]["longitude"]
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]
    radius = int(cfg.get("nearby_stations", {}).get("radius_km", 25))
    limit = int(cfg.get("nearby_stations", {}).get("max_items", 6))

    fields = ",".join([
        "place.name",
        "place.country",
        "place.state",
        "loc.lat",
        "loc.long",
        "profile.tz",
        "ob.timestamp",
        "ob.tempC",
        "ob.weather",
        "ob.icon",
        "ob.windSpeedKPH",
        "ob.windDirDEG",
        "ob.pressureMB",
        "ob.humidity",
    ])

    params = {
        "client_id": client_id,
        "client_secret": client_secret,
        "p": f"{lat},{lon}",
        "radius": f"{radius}km",
        "limit": limit,
        "format": "json",
        "fields": fields,
    }

    return f"https://data.api.xweather.com/observations/closest?{urlencode(params)}"


def parse_response(payload: dict, cfg: dict) -> dict:
    response = payload.get("response", [])
    lat0 = cfg["station"]["latitude"]
    lon0 = cfg["station"]["longitude"]

    stations = []
    for item in response:
        place = item.get("place", {}) or {}
        loc = item.get("loc", {}) or {}
        ob = item.get("ob", {}) or {}

        lat = clean_num(loc.get("lat"))
        lon = clean_num(loc.get("long"))

        distance_km = None
        if lat is not None and lon is not None:
            distance_km = round(haversine_km(lat0, lon0, lat, lon), 1)

        name = place.get("name") or "Stazione"
        country = place.get("country") or ""
        state = place.get("state") or ""

        stations.append({
            "name": name,
            "country": country,
            "state": state,
            "distance_km": distance_km,
            "tempC": ob.get("tempC"),
            "weather": ob.get("weather"),
            "windKph": ob.get("windSpeedKPH"),
            "windDirDeg": ob.get("windDirDEG"),
            "pressureMb": ob.get("pressureMB"),
            "humidity": ob.get("humidity"),
            "timestamp": ob.get("timestamp"),
        })

    stations.sort(key=lambda x: (99999 if x["distance_km"] is None else x["distance_km"]))

    return {
        "provider": "Xweather Observations",
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stations": stations
    }


def main() -> int:
    try:
        cfg = load_config()
        if not cfg.get("nearby_stations", {}).get("enabled", True):
            return 0

        public_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_dir / "nearby-stations.json"

        url = build_url(cfg)
        print(url)
        payload = fetch_json(url)
        data = parse_response(payload, cfg)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"OK scritto {output_path}")
        return 0
    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
