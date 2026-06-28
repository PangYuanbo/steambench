# Windows local NitroGen control

This runs the model and a Steam game on the same NVIDIA GPU:

```text
DXGI screen capture -> local NitroGen inference -> virtual Xbox controller
```

## Install

Use Windows 11, an NVIDIA driver, Git, and Python 3.11. In PowerShell from the
repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\runtime\windows\setup_nitrogen.ps1
```

## Run

Start the game in borderless fullscreen, then run:

```powershell
.\.venv\Scripts\python.exe runtime\windows\nitrogen_local_play.py --region 0 0 1920 1080
```

For a 2560x1440 display use `--region 0 0 2560 1440`. The coordinates are
`LEFT TOP RIGHT BOTTOM`, not width and height.

- `F8`: pause/resume the virtual controller
- `End`: stop and release all controls
- `Ctrl+C`: stop and release all controls
- Menu, Guide, and Back are blocked unless `--allow-menu` is supplied

If Steam selects a physical controller instead of the virtual Xbox controller,
disconnect the physical controller for the first test.

## Watch from another browser

The viewing stream is separate from model control. FFmpeg uses the RTX 5090's
NVENC encoder and publishes H.264 without B-frames to MediaMTX WebRTC.

```powershell
.\runtime\windows\setup_watch_stream.ps1
.\runtime\windows\start_watch_stream.ps1 -Region 0,0,1920,1080
```

The script prints URLs such as:

```text
http://192.168.1.50:8889/ai
```

Open the URL from a browser on the same LAN or Tailscale network. Windows
Firewall must allow TCP `8889` and TCP/UDP `8189` on Private networks. Do not
expose these anonymous viewer ports directly to the public internet.

Streaming defaults to the source resolution at 60 FPS and 12 Mbps. Change it
with `-Fps 30` or `-BitrateKbps 8000`. `-Region` uses
`LEFT,TOP,WIDTH,HEIGHT`, unlike the Python controller's right/bottom format.
