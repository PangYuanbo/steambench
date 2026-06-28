$ErrorActionPreference = "Stop"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python 3.11 is required. Install it from python.org with the py launcher."
}

if (-not (Test-Path ".venv")) {
    py -3.11 -m venv .venv
}

$Python = Join-Path $PWD ".venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
& $Python -m pip install numpy pyzmq pyyaml einops "transformers==4.53.0" pydantic diffusers polars pillow opencv-python av huggingface_hub dxcam vgamepad

New-Item -ItemType Directory -Force external, models | Out-Null
if (-not (Test-Path "external\NitroGen")) {
    git clone --depth 1 https://github.com/MineDojo/NitroGen.git external/NitroGen
}
& $Python -m pip install -e external/NitroGen --no-deps
& $Python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='nvidia/NitroGen', filename='ng.pt', local_dir='models')"

Write-Host ""
Write-Host "Ready. Start the game, then run:"
Write-Host ".\.venv\Scripts\python.exe runtime\windows\nitrogen_local_play.py --region 0 0 1920 1080"
Write-Host "F8 pauses the virtual controller; End exits and releases it."
