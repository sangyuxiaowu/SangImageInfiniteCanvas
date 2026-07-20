"""OpenAI-compatible image generation mock service for local UI testing.

Run: python script/mock_image_api.py
Configure the app with base URL http://127.0.0.1:8000/v1 and any API key.
"""

import base64
import json
import struct
import time
import zlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 8000
MIN_PIXELS = 655_360
MAX_PIXELS = 8_294_400
MAX_EDGE = 3_840
MAX_RATIO = 3
RESPONSE_DELAY_SECONDS = 10


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)


def create_png(width: int, height: int, index: int) -> bytes:
    """Create a valid solid-color RGBA PNG without third-party packages."""
    colors = ((99, 102, 241), (16, 185, 129), (245, 158, 11), (244, 63, 94))
    red, green, blue = colors[index % len(colors)]
    row = b"\x00" + bytes((red, green, blue, 255)) * width
    image_data = zlib.compress(row * height, level=9)
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return header + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", image_data) + png_chunk(b"IEND", b"")


def parse_size(size: object) -> tuple[int, int]:
    if not isinstance(size, str) or "x" not in size:
        raise ValueError("size must use the format WIDTHxHEIGHT, for example 1024x1024")

    try:
        width_text, height_text = size.lower().split("x", 1)
        width, height = int(width_text), int(height_text)
    except ValueError as error:
        raise ValueError("size must use integer WIDTHxHEIGHT values") from error

    pixels = width * height
    if width % 16 or height % 16:
        raise ValueError("both size edges must be multiples of 16")
    if min(width, height) <= 0 or max(width, height) > MAX_EDGE:
        raise ValueError(f"size edges must be between 16 and {MAX_EDGE}")
    if max(width, height) / min(width, height) > MAX_RATIO:
        raise ValueError(f"aspect ratio must not exceed {MAX_RATIO}:1")
    if not MIN_PIXELS <= pixels <= MAX_PIXELS:
        raise ValueError(f"pixel count must be between {MIN_PIXELS} and {MAX_PIXELS}")
    return width, height


def parse_multipart_fields(body: bytes, boundary: bytes) -> tuple[dict[str, str], list[str]]:
    """Extract text fields and uploaded file field names from multipart requests."""
    fields: dict[str, str] = {}
    files: list[str] = []
    for part in body.split(b"--" + boundary):
        headers, separator, value = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        marker = b'name="'
        start = headers.find(marker)
        if start < 0:
            continue
        start += len(marker)
        end = headers.find(b'"', start)
        if end < 0:
            continue
        name = headers[start:end].decode("utf-8")
        if b"filename=" in headers:
            files.append(name)
        else:
            fields[name] = value.rstrip(b"\r\n-").decode("utf-8")
    return fields, files


class MockImageHandler(BaseHTTPRequestHandler):
    server_version = "MockImageAPI/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, status: int, body: dict) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": {"message": "Not found"}})

    def do_POST(self) -> None:
        if self.path not in {"/v1/images/generations", "/v1/images/edits"}:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": {"message": "Not found"}})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length)
            if self.path == "/v1/images/edits":
                content_type = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in content_type or "boundary=" not in content_type:
                    raise ValueError("edits requests must use multipart/form-data")
                boundary = content_type.split("boundary=", 1)[1].strip().strip('"').encode("utf-8")
                payload, file_fields = parse_multipart_fields(body, boundary)
                if "image" not in file_fields:
                    raise ValueError("edits requests must include an image file")
                print(f"Edit multipart files: {', '.join(file_fields)}")
            else:
                payload = json.loads(body.decode("utf-8"))
            width, height = parse_size(payload.get("size", "1024x1024"))
            count = int(payload.get("n", 1))
            if not 1 <= count <= 10:
                raise ValueError("n must be between 1 and 10")
        except (json.JSONDecodeError, ValueError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": {"message": str(error), "type": "invalid_request_error"}})
            return

        time.sleep(RESPONSE_DELAY_SECONDS)

        data = []
        for index in range(count):
            image = create_png(width, height, index)
            data.append({"b64_json": base64.b64encode(image).decode("ascii")})

        operation = "Edited" if self.path == "/v1/images/edits" else "Generated"
        print(f"{operation} {count} mock image(s) at {width}x{height}")
        self.send_json(HTTPStatus.OK, {
            "created": int(time.time()),
            "data": data,
            "size": f"{width}x{height}",
            "model": payload.get("model", "mock-image"),
        })


if __name__ == "__main__":
    print(f"Mock image API listening at http://{HOST}:{PORT}/v1")
    ThreadingHTTPServer((HOST, PORT), MockImageHandler).serve_forever()