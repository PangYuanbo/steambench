$ErrorActionPreference = "Stop"

$Tools = Join-Path $PWD "tools\windows-stream"
New-Item -ItemType Directory -Force $Tools | Out-Null

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required to install FFmpeg. Install Microsoft App Installer first."
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
}

$Release = Invoke-RestMethod "https://api.github.com/repos/bluenviron/mediamtx/releases/latest"
$Asset = $Release.assets | Where-Object { $_.name -match "windows_amd64\.zip$" } | Select-Object -First 1
if (-not $Asset) {
    throw "MediaMTX Windows amd64 release was not found."
}

$Zip = Join-Path $Tools "mediamtx.zip"
Invoke-WebRequest $Asset.browser_download_url -OutFile $Zip
Expand-Archive $Zip -DestinationPath $Tools -Force
Remove-Item $Zip

$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($IsAdmin) {
    New-NetFirewallRule -DisplayName "SteamBench Viewer HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8889 -Profile Private -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "SteamBench Viewer WebRTC TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8189 -Profile Private -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "SteamBench Viewer WebRTC UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8189 -Profile Private -ErrorAction SilentlyContinue | Out-Null
} else {
    Write-Warning "Run this setup once as Administrator to add Private-network firewall rules for TCP 8889 and TCP/UDP 8189."
}

Write-Host ""
Write-Host "Viewer dependencies installed. Open a new PowerShell if FFmpeg was just installed."
Write-Host "Start 1080p60 viewing with:"
Write-Host ".\runtime\windows\start_watch_stream.ps1 -Region 0,0,1920,1080"
