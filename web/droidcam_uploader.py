"""DroidCam periodic uploader for Cold Storage dashboard testing.

Captures either:
- a single image from a snapshot URL (--image-url), or
- a single JPEG frame from an MJPEG stream URL (--stream-url)

and uploads it to the existing backend endpoint (/api/upload-image)
at a fixed interval.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import time
from urllib.parse import urljoin, urlparse

import requests


def log(message: str) -> None:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}")


def capture_image_bytes(
    image_url: str, connect_timeout: float, read_timeout: float
) -> bytes:
    response = requests.get(image_url, timeout=(connect_timeout, read_timeout))
    response.raise_for_status()

    if not response.content:
        raise RuntimeError("Snapshot endpoint returned an empty image")

    return response.content


def capture_mjpeg_frame_bytes(
    stream_url: str,
    connect_timeout: float,
    read_timeout: float,
    max_buffer_bytes: int = 8_000_000,
) -> bytes:
    with requests.get(
        stream_url, stream=True, timeout=(connect_timeout, read_timeout)
    ) as response:
        response.raise_for_status()

        content_type = (response.headers.get("content-type") or "").lower()
        if "image/" in content_type:
            data = response.content
            if data:
                return data

        if "text/html" in content_type:
            html = response.text or ""
            if "droidcam is busy" in html.lower():
                raise RuntimeError(
                    "DroidCam stream is busy. Close other DroidCam client sessions and retry."
                )
            if "video inactive" in html.lower():
                raise RuntimeError(
                    "DroidCam video is inactive. Start the camera stream in the phone app and retry."
                )
            resolved = resolve_capture_url_from_html(stream_url, html)
            if resolved and resolved != stream_url:
                return capture_mjpeg_frame_bytes(
                    resolved,
                    connect_timeout=connect_timeout,
                    read_timeout=read_timeout,
                    max_buffer_bytes=max_buffer_bytes,
                )

        buffer = bytearray()
        for chunk in response.iter_content(chunk_size=4096):
            if not chunk:
                continue

            buffer.extend(chunk)

            start = buffer.find(b"\xff\xd8")
            end = buffer.find(b"\xff\xd9", start + 2 if start != -1 else 0)
            if start != -1 and end != -1 and end > start:
                return bytes(buffer[start : end + 2])

            if len(buffer) > max_buffer_bytes:
                del buffer[: len(buffer) - max_buffer_bytes // 2]

    raise RuntimeError("Failed to extract a JPEG frame from MJPEG stream")


def resolve_capture_url_from_html(base_url: str, html: str) -> str | None:
    # Try explicit image/video links in the HTML first.
    matches = re.findall(r"(?:src|href)=[\"']([^\"']+)[\"']", html, flags=re.I)
    for raw in matches:
        candidate = urljoin(base_url, raw.strip())
        lower = candidate.lower()
        if any(
            token in lower
            for token in ("mjpeg", "/video", "shot.jpg", ".jpg", ".jpeg", ".mjpg")
        ):
            return candidate

    # Fallback to common DroidCam/phone camera endpoints on the same host.
    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"
    for path in (
        "/video",
        "/mjpeg",
        "/mjpegfeed",
        "/videofeed",
        "/video.mjpg",
        "/shot.jpg",
    ):
        candidate = root + path
        if candidate != base_url:
            return candidate

    return None


def build_stream_candidates(stream_url: str) -> list[str]:
    parsed = urlparse(stream_url)
    root = f"{parsed.scheme}://{parsed.netloc}"

    candidates = [
        stream_url,
        root + "/video",
        root + "/mjpeg",
        root + "/mjpegfeed",
        root + "/videofeed",
        root + "/video.mjpg",
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate not in seen:
            deduped.append(candidate)
            seen.add(candidate)
    return deduped


def capture_from_stream_with_fallback(
    stream_url: str,
    connect_timeout: float,
    read_timeout: float,
) -> tuple[bytes, str]:
    errors: list[str] = []
    for candidate in build_stream_candidates(stream_url):
        try:
            image_bytes = capture_mjpeg_frame_bytes(
                candidate,
                connect_timeout=connect_timeout,
                read_timeout=read_timeout,
            )
            return image_bytes, candidate
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{candidate} -> {exc}")

    detail = " | ".join(errors[-3:]) if errors else "unknown"
    raise RuntimeError(
        "No usable HTTP image/stream endpoint found for DroidCam URL. "
        "This usually means the current DroidCam mode does not expose MJPEG/JPEG over HTTP. "
        f"Recent errors: {detail}"
    )


def upload_image_bytes(
    image_bytes: bytes,
    api_url: str,
    connect_timeout: float,
    read_timeout: float,
) -> dict:
    files = {
        "image": (
            "droidcam_capture.jpg",
            image_bytes,
            "image/jpeg",
        )
    }

    response = requests.post(
        api_url,
        files=files,
        timeout=(connect_timeout, read_timeout),
    )
    response.raise_for_status()
    return response.json()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture DroidCam images and upload to Cold Storage backend"
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--image-url",
        help=(
            "Single-image snapshot URL, for example "
            "http://192.168.1.50:4747/shot.jpg"
        ),
    )
    source_group.add_argument(
        "--stream-url",
        help=(
            "DroidCam video stream URL, for example "
            "http://192.168.1.50:4747/video"
        ),
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:3000/api/upload-image",
        help="Upload endpoint URL (default: http://localhost:3000/api/upload-image)",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=300,
        help="Capture/upload interval in seconds (default: 300 = 5 minutes)",
    )
    parser.add_argument(
        "--retry-seconds",
        type=int,
        default=15,
        help="Delay before retry after a failure (default: 15)",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=95,
        help="Reserved for compatibility in no-reencode mode (default: 95)",
    )
    parser.add_argument(
        "--connect-timeout",
        type=float,
        default=10.0,
        help="HTTP connect timeout seconds (default: 10)",
    )
    parser.add_argument(
        "--read-timeout",
        type=float,
        default=60.0,
        help="HTTP read timeout seconds (default: 60)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.interval_seconds < 1:
        raise ValueError("--interval-seconds must be >= 1")

    if not (0 <= args.jpeg_quality <= 100):
        raise ValueError("--jpeg-quality must be between 0 and 100")

    log("Starting DroidCam uploader")
    if args.image_url:
        log(f"Image URL: {args.image_url}")
    else:
        log(f"Stream URL: {args.stream_url}")
    log(f"Upload URL: {args.api_url}")
    log(f"Interval: {args.interval_seconds} seconds")

    active_stream_url = args.stream_url

    while True:
        cycle_started = time.time()
        try:
            if args.image_url:
                upload_bytes = capture_image_bytes(
                    args.image_url,
                    connect_timeout=args.connect_timeout,
                    read_timeout=args.read_timeout,
                )
            else:
                upload_bytes, resolved_stream_url = capture_from_stream_with_fallback(
                    active_stream_url,
                    connect_timeout=args.connect_timeout,
                    read_timeout=args.read_timeout,
                )
                if resolved_stream_url != active_stream_url:
                    log(f"Using capture endpoint: {resolved_stream_url}")
                    active_stream_url = resolved_stream_url

            payload = upload_image_bytes(
                upload_bytes,
                api_url=args.api_url,
                connect_timeout=args.connect_timeout,
                read_timeout=args.read_timeout,
            )

            detected = payload.get("detected") or payload.get("rawDetectedLabel") or "none"
            provider = str(payload.get("provider") or "inference").upper()
            log(f"Upload successful | Provider: {provider} | Detected: {detected}")

            elapsed = time.time() - cycle_started
            sleep_for = max(0, args.interval_seconds - elapsed)
            time.sleep(sleep_for)
        except Exception as exc:  # noqa: BLE001
            log(f"Upload failed: {exc}")
            log(f"Retrying in {args.retry_seconds} seconds")
            time.sleep(args.retry_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
