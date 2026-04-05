#!/usr/bin/env python3
import json
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path("/home/pi/mydashboard")
CONFIG_PATH = BASE_DIR / "config" / "dashboard.json"


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def main():
    try:
        cfg = load_config()
        public_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_dir / "map-layers.json"

        station = cfg.get("station", {})
        radar = cfg.get("radar", {})
        ow = cfg.get("openweather", {})

        data = {
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "center_lat": radar.get("center_lat", station.get("latitude")),
            "center_lon": radar.get("center_lon", station.get("longitude")),
            "zoom": radar.get("zoom", 7),
            "openweather_api_key": ow.get("api_key", ""),
            "layers": [
                {"id": "clouds_new", "label": "Nubi"},
                {"id": "wind_new", "label": "Vento"},
                {"id": "pressure_new", "label": "Pressione"},
                {"id": "temp_new", "label": "Temperatura"},
                {"id": "precipitation_new", "label": "Precipitazioni"}
            ]
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
