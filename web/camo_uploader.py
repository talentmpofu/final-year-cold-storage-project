"""Camo periodic uploader for Cold Storage dashboard testing.

Captures still frames from a local webcam device (Camo virtual camera)
and uploads them to the existing backend endpoint (/api/upload-image)
at a fixed interval.
"""

from __future__ import annotations

import argparse
import datetime as dt
import time

import requests


def log(message: str) -> None:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}")


def load_cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError(
            "OpenCV is required for Camo capture. Install with: pip install opencv-python"
        ) from exc
    return cv2


def resolve_camera_index(cv2, preferred_index: int) -> int:
    if preferred_index >= 0:
        return preferred_index

    last_working_index = None
    for index in range(0, 8):
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if cap.isOpened():
            ok, _ = cap.read()
            cap.release()
            if ok:
                last_working_index = index
        else:
            cap.release()

    if last_working_index is not None:
        return last_working_index

    raise RuntimeError(
        "No usable webcam device found. Ensure Camo Studio virtual camera is running."
    )


def capture_frame_bytes(
    cv2,
    camera_index: int,
    jpeg_quality: int,
    frame_width: int,
    frame_height: int,
) -> bytes:
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise RuntimeError(
            f"Failed to open webcam index {camera_index}. Check Camo virtual camera status."
        )

    try:
        if frame_width > 0:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(frame_width))
        if frame_height > 0:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(frame_height))

        frame = None
        for _ in range(5):
            ok, current = cap.read()
            if ok and current is not None:
                frame = current

        if frame is None:
            raise RuntimeError("Unable to read frame from Camo virtual camera")

        ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)]
        )
        if not ok:
            raise RuntimeError("Failed to encode captured frame as JPEG")

        return encoded.tobytes()
    finally:
        cap.release()


def upload_image_bytes(
    image_bytes: bytes,
    api_url: str,
    connect_timeout: float,
    read_timeout: float,
) -> dict:
    files = {
        "image": (
            "camo_capture.jpg",
            image_bytes,
            "image/jpeg",
        )
    }

    data = {
        "source": "camo",
    }

    response = requests.post(
        api_url,
        data=data,
        files=files,
        timeout=(connect_timeout, read_timeout),
    )
    response.raise_for_status()
    return response.json()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture Camo camera frames and upload to Cold Storage backend"
    )
    parser.add_argument(
        "--webcam-index",
        type=int,
        default=-1,
        help="Webcam index to use (-1 = auto detect, default: -1)",
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
        help="Delay before retry after failure (default: 15)",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=95,
        help="JPEG quality 0-100 (default: 95)",
    )
    parser.add_argument(
        "--frame-width",
        type=int,
        default=0,
        help="Requested capture width in pixels (0 = camera default)",
    )
    parser.add_argument(
        "--frame-height",
        type=int,
        default=0,
        help="Requested capture height in pixels (0 = camera default)",
    )
    parser.add_argument(
        "--connect-timeout",
        type=float,
        default=10.0,
        help="HTTP connect timeout in seconds (default: 10)",
    )
    parser.add_argument(
        "--read-timeout",
        type=float,
        default=60.0,
        help="HTTP read timeout in seconds (default: 60)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.interval_seconds < 1:
        raise ValueError("--interval-seconds must be >= 1")

    if args.retry_seconds < 1:
        raise ValueError("--retry-seconds must be >= 1")

    if not (0 <= args.jpeg_quality <= 100):
        raise ValueError("--jpeg-quality must be between 0 and 100")

    cv2 = load_cv2()
    camera_index = resolve_camera_index(cv2, args.webcam_index)

    log("Starting Camo uploader")
    log(f"Webcam index: {camera_index}")
    log(f"Upload URL: {args.api_url}")
    log(f"Interval: {args.interval_seconds} seconds")

    while True:
        cycle_started = time.time()
        try:
            image_bytes = capture_frame_bytes(
                cv2=cv2,
                camera_index=camera_index,
                jpeg_quality=args.jpeg_quality,
                frame_width=args.frame_width,
                frame_height=args.frame_height,
            )

            payload = upload_image_bytes(
                image_bytes=image_bytes,
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
