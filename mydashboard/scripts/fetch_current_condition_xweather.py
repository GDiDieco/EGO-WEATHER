#!/usr/bin/env python3
import json
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


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def first_non_null(*values):
    for v in values:
        if v is not None:
            return v
    return None


def build_url(cfg: dict) -> str:
    lat = cfg["station"]["latitude"]
    lon = cfg["station"]["longitude"]
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]

    params = {
        "client_id": client_id,
        "client_secret": client_secret,
        "p": f"{lat},{lon}",
        "format": "json"
    }

    return f"https://data.api.xweather.com/conditions?{urlencode(params)}"


def parse_payload(payload: dict) -> dict:
    response = payload.get("response") or []
    if not response:
        return {
            "provider": "Xweather Conditions",
            "updated": now_str(),
            "status": {"ok": False, "message": "No condition data"},
            "condition": None
        }

    item = response[0] if isinstance(response, list) else response
    ob = item.get("ob", {}) or {}
    periods = item.get("periods") or []
    period0 = periods[0] if periods and isinstance(periods[0], dict) else {}

    weather = first_non_null(
        ob.get("weather"),
        item.get("weather"),
        period0.get("weather"),
        period0.get("weatherPrimary")
    )

    icon = first_non_null(
        ob.get("icon"),
        item.get("icon"),
        period0.get("icon")
    )

    is_day = first_non_null(
        ob.get("isDay"),
        item.get("isDay"),
        period0.get("isDay")
    )

    return {
        "provider": "Xweather Conditions",
        "updated": now_str(),
        "status": {"ok": True, "message": None},
        "condition": {
            "weather": weather,
            "icon": icon,
            "isDay": is_day
        }
    }


def main() -> int:
    try:
        cfg = load_config()
        public_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_dir / "current-condition.json"

        url = build_url(cfg)
        payload = fetch_json(url)
        data = parse_payload(payload)

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
