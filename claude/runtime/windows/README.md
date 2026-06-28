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
