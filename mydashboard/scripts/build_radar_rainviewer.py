#!/usr/bin/env python3
import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"
RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json"


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str):
    req = Request(url, headers={"User-Agent": "mydashboard/1.0"})
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    try:
        cfg = load_config()
        public_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_dir / "radar-rainviewer.json"

        rv = fetch_json(RAINVIEWER_API)
        radar_cfg = cfg.get("radar", {})
        station = cfg.get("station", {})

        host = rv.get("host", "https://tilecache.rainviewer.com")
        past = rv.get("radar", {}).get("past", [])

        frames = []
        for frame in past[-8:]:
            frames.append({
                "time": frame.get("time"),
                "path": frame.get("path")
            })

        data = {
            "enabled": radar_cfg.get("enabled", True),
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "host": host,
            "frames": frames,
            "center_lat": radar_cfg.get("center_lat", station.get("latitude")),
            "center_lon": radar_cfg.get("center_lon", station.get("longitude")),
            "zoom": radar_cfg.get("zoom", 7),
            "color": radar_cfg.get("rainviewer_color", 6),
            "smooth": radar_cfg.get("rainviewer_smooth", 1),
            "snow": radar_cfg.get("rainviewer_snow", 1),
            "frame_interval_ms": radar_cfg.get("frame_interval_ms", 700)
        }

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
