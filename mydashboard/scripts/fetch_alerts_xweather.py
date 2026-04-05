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


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


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


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "rpiweather-dashboard/1.0"})
    with urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def safe_str(v, fallback=None):
    if v is None:
        return fallback
    s = str(v).strip()
    return s if s else fallback


def base_payload() -> dict:
    return {
        "provider": {
            "id": "xweather",
            "name": "Xweather Alerts"
        },
        "status": {
            "ok": False,
            "stale": False,
            "hasAlerts": False,
            "message": None,
            "lastSuccess": None
        },
        "updated": None,
        "location": {},
        "alerts": []
    }


def merge_stale(existing: Optional[dict], message: str) -> dict:
    if existing and isinstance(existing, dict):
        out = deepcopy(existing)
        out.setdefault("status", {})
        out["status"].update({
            "ok": True,
            "stale": True,
            "message": message,
            "lastSuccess": out.get("updated") or out.get("status", {}).get("lastSuccess")
        })
        return out

    out = base_payload()
    out["status"].update({
        "ok": False,
        "stale": False,
        "message": message
    })
    return out


def build_url(cfg: dict) -> str:
    lat = cfg["station"]["latitude"]
    lon = cfg["station"]["longitude"]
    client_id = cfg["xweather"]["client_id"]
    client_secret = cfg["xweather"]["client_secret"]

    params = {
        "client_id": client_id,
        "client_secret": client_secret,
        "format": "json",
    }

    return f"https://data.api.xweather.com/alerts/{lat},{lon}?{urlencode(params)}"


def normalize_alert(item: dict) -> dict:
    details = item.get("details") or {}
    timestamps = item.get("timestamps") or {}
    profile = item.get("profile") or {}
    body = item.get("body") or item.get("longDesc") or item.get("name")

    return {
        "id": safe_str(item.get("id")),
        "title": safe_str(item.get("name"), "Allerta meteo"),
        "severity": safe_str(details.get("severity"), safe_str(item.get("priority"), "unknown")),
        "color": safe_str(details.get("color")),
        "source": safe_str(item.get("source"), safe_str(profile.get("name"), "unknown")),
        "body": safe_str(body, "Dettaglio non disponibile"),
        "beginsISO": safe_str(timestamps.get("beginsISO")),
        "expiresISO": safe_str(timestamps.get("expiresISO")),
        "issuedISO": safe_str(timestamps.get("issuedISO")),
        "areas": item.get("areas") if isinstance(item.get("areas"), list) else [],
    }


def transform(payload: dict, cfg: dict) -> dict:
    out = base_payload()
    response = payload.get("response") or []
    error = payload.get("error") or {}

    alerts = [normalize_alert(item) for item in response if isinstance(item, dict)]

    station = cfg.get("station", {})
    out["updated"] = now_iso()
    out["location"] = {
        "latitude": station.get("latitude"),
        "longitude": station.get("longitude"),
    }
    out["alerts"] = alerts

    if alerts:
        message = f"{len(alerts)} allerta/e attiva/e"
    else:
        code = safe_str(error.get("code"))
        if code == "warn_no_data":
            message = "Nessuna allerta attiva"
        else:
            message = "Nessuna allerta attiva"

    out["status"].update({
        "ok": True,
        "stale": False,
        "hasAlerts": bool(alerts),
        "message": message,
        "lastSuccess": out["updated"],
    })
    return out


def main() -> int:
    output_path = None
    try:
        cfg = load_config()
        public_data_dir = Path(cfg["paths"]["public_data_dir"])
        output_path = public_data_dir / "alerts.json"

        url = build_url(cfg)
        payload = fetch_json(url)
        out = transform(payload, cfg)
        write_json(output_path, out)
        print(f"OK scritto {output_path}")
        return 0

    except Exception as e:
        if output_path is None:
            try:
                cfg = load_config()
                output_path = Path(cfg["paths"]["public_data_dir"]) / "alerts.json"
            except Exception:
                output_path = Path("alerts.json")

        previous = read_json_file(output_path)
        fallback = merge_stale(previous, f"Aggiornamento weather alerts fallito: {e}")
        write_json(output_path, fallback)
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
