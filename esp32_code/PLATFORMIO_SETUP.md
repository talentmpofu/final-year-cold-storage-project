PlatformIO setup (Windows)

This file shows the simplest ways to install PlatformIO and build the ESP32 project locally on Windows.

Options:

1) Using Python/pip (recommended for CLI builds)

- Ensure Python 3 is installed and on PATH. Open PowerShell and verify:

  py -3 --version

- Install PlatformIO using pip (per-user):

  py -3 -m pip install --user platformio

- Add the user scripts folder to PATH if needed (PowerShell):

  $env:Path += ";$env:USERPROFILE\AppData\Roaming\Python\Python39\Scripts"

  (Replace Python39 with your Python version folder.)

- Build the project from the `esp32_code` folder:

  cd "c:\Users\talen\Desktop\Cold storage unit\esp32_code"
  platformio run

- Upload to your ESP32 (adjust port):

  platformio run --target upload --upload-port COM3

2) Using VS Code (PlatformIO IDE)

- Install VS Code: https://code.visualstudio.com/
- Open VS Code, install the "PlatformIO IDE" extension from the Extensions view.
- Use the PlatformIO UI (left activity bar) to open the project and click "Build" and "Upload".

Troubleshooting:
- If `platformio` command is not found after installation, open a new PowerShell window (to refresh PATH) and try again.
- On Windows, if `py -3` is unavailable, try `python -m pip install --user platformio`.
- If pip install fails due to permissions, use `--user` or run an elevated PowerShell.

Notes:
- Building requires an internet connection to download platform packages the first time.
- If you prefer a containerized approach, let me know and I can add a Dockerfile to build the firmware without installing PlatformIO globally.
