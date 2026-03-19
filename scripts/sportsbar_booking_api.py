#!/usr/bin/env python3

import base64
import datetime as dt
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHEET_ID = os.environ.get("SPORTSBAR_SHEET_ID", "1Oj95Oe9hMRYjgDzuuYewC_ti51nh0FO91WRUNjMvspk")
PORT = int(os.environ.get("SPORTSBAR_BOOKING_PORT", "8787"))
CREDS_PATH = Path(
    os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS",
        ROOT / "t8booking-4c0510f7edb4.json",
    )
)


def load_credentials():
    with CREDS_PATH.open() as handle:
        return json.load(handle)


CREDS = load_credentials()


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def get_token():
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    now = int(time.time())
    claim = b64url(
        json.dumps(
            {
                "iss": CREDS["client_email"],
                "scope": "https://www.googleapis.com/auth/spreadsheets",
                "aud": "https://oauth2.googleapis.com/token",
                "exp": now + 3600,
                "iat": now,
            }
        ).encode()
    )
    message = f"{header}.{claim}"

    with tempfile.NamedTemporaryFile("w", delete=False) as key_file:
        key_file.write(CREDS["private_key"])
        key_path = key_file.name

    try:
        signature = subprocess.check_output(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=message.encode(),
        )
    finally:
        os.unlink(key_path)

    jwt = f"{message}.{b64url(signature)}"
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": jwt,
            }
        ).encode(),
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)["access_token"]


def google_request(url, method="GET", body=None):
    token = get_token()
    request = urllib.request.Request(url, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        request.add_header("Content-Type", "application/json")
        request.data = json.dumps(body).encode()
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def get_sheet_values(sheet_name):
    encoded = urllib.parse.quote(f"{sheet_name}!A1:Z5000", safe="!:")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded}"
    payload = google_request(url)
    return payload.get("values", [])


def update_range(a1_range, values):
    encoded = urllib.parse.quote(a1_range, safe="!:")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded}?valueInputOption=RAW"
    body = {
        "range": a1_range,
        "majorDimension": "ROWS",
        "values": values,
    }
    return google_request(url, method="PUT", body=body)


def append_range(a1_range, values):
    encoded = urllib.parse.quote(a1_range, safe="!:")
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded}:append"
        "?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
    )
    body = {"majorDimension": "ROWS", "values": values}
    return google_request(url, method="POST", body=body)


def rows_as_dicts(sheet_name):
    rows = get_sheet_values(sheet_name)
    if not rows:
        return [], []
    header = rows[0]
    records = []
    for row_index, row in enumerate(rows[1:], start=2):
        padded = row + [""] * (len(header) - len(row))
        item = dict(zip(header, padded))
        item["_row"] = row_index
        records.append(item)
    return header, records


def resource_lookup():
    _, records = rows_as_dicts("Resources")
    return {record["resource_id"]: record for record in records}


def list_bookings(limit=12):
    _, bookings = rows_as_dicts("Bookings")
    bookings.sort(key=lambda row: (row.get("date", ""), row.get("start_time", "")))
    return bookings[:limit]


def list_availability(date_value=None, booking_type=None, party_size=None, limit=18):
    _, slots = rows_as_dicts("Slots")
    resources = resource_lookup()
    matches = []

    for slot in slots:
        if slot.get("status") != "available":
            continue
        if date_value and slot.get("date") != date_value:
            continue
        if booking_type and slot.get("booking_type") != booking_type:
            continue
        try:
            max_size = int(slot.get("party_size_max") or 0)
        except ValueError:
            max_size = 0
        if party_size and max_size < party_size:
            continue

        resource = resources.get(slot.get("resource_id"), {})
        matches.append(
            {
                "slot_id": slot.get("slot_id"),
                "resource_id": slot.get("resource_id"),
                "resource_name": resource.get("name", slot.get("resource_id")),
                "booking_type": slot.get("booking_type"),
                "date": slot.get("date"),
                "start_time": slot.get("start_time"),
                "end_time": slot.get("end_time"),
                "party_size_max": max_size,
                "price_sek": slot.get("price_sek"),
            }
        )

    matches.sort(key=lambda row: (row["date"], row["start_time"], row["party_size_max"], row["resource_name"]))
    return matches[:limit]


def create_booking(payload):
    required = ["customer_name", "phone", "party_size", "booking_type", "date", "start_time"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
      raise ValueError(f"Saknar fält: {', '.join(missing)}")

    party_size = int(payload["party_size"])
    booking_type = payload["booking_type"]
    date_value = payload["date"]
    start_time = payload["start_time"]

    _, slots = rows_as_dicts("Slots")
    resources = resource_lookup()

    candidates = []
    for slot in slots:
        if slot.get("status") != "available":
            continue
        if slot.get("booking_type") != booking_type:
            continue
        if slot.get("date") != date_value:
            continue
        if slot.get("start_time") != start_time:
            continue
        try:
            max_size = int(slot.get("party_size_max") or 0)
        except ValueError:
            max_size = 0
        if max_size < party_size:
            continue
        resource = resources.get(slot.get("resource_id"), {})
        candidates.append((max_size, resource.get("name", slot.get("resource_id")), slot))

    if not candidates:
        raise ValueError("Ingen ledig tid matchar vald typ, datum, tid och sällskapsstorlek.")

    _, _, selected = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
    resource_name = resources.get(selected["resource_id"], {}).get("name", selected["resource_id"])

    update_range(f"Slots!F{selected['_row']}:J{selected['_row']}", [[
        "booked",
        selected.get("booking_type"),
        selected.get("party_size_max"),
        selected.get("price_sek"),
        payload.get("notes", "Booked via Team8 sportsbar demo"),
    ]])

    booking_id = f"book_{int(time.time())}"
    created_at = dt.datetime.now().replace(microsecond=0).isoformat()
    append_range(
        "Bookings!A:L",
        [[
            booking_id,
            created_at,
            payload["customer_name"],
            payload["phone"],
            str(party_size),
            booking_type,
            selected["slot_id"],
            selected["resource_id"],
            date_value,
            start_time,
            "confirmed",
            payload.get("notes", "Booked via Team8 sportsbar demo"),
        ]],
    )

    return {
        "booking_id": booking_id,
        "customer_name": payload["customer_name"],
        "resource_id": selected["resource_id"],
        "resource_name": resource_name,
        "date": date_value,
        "start_time": start_time,
        "status": "confirmed",
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode()
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_json(204, {})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if parsed.path == "/health":
                self.send_json(200, {"ok": True, "sheet": "Google Sheets"})
                return

            if parsed.path == "/bookings":
                limit = int(query.get("limit", ["12"])[0])
                self.send_json(200, {"items": list_bookings(limit=limit)})
                return

            if parsed.path == "/availability":
                party_size = query.get("party_size", [None])[0]
                self.send_json(
                    200,
                    {
                        "items": list_availability(
                            date_value=query.get("date", [None])[0],
                            booking_type=query.get("booking_type", [None])[0],
                            party_size=int(party_size) if party_size else None,
                            limit=int(query.get("limit", ["18"])[0]),
                        )
                    },
                )
                return

            self.send_json(404, {"error": "Not found"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/book":
            self.send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode() if length else "{}"
            payload = json.loads(body)
            result = create_booking(payload)
            self.send_json(200, result)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except urllib.error.HTTPError as error:
            details = error.read().decode()
            self.send_json(502, {"error": f"Google API error: {details}"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Sportsbar booking API running on http://127.0.0.1:{PORT}")
    print(f"Using sheet {SHEET_ID}")
    server.serve_forever()


if __name__ == "__main__":
    main()
