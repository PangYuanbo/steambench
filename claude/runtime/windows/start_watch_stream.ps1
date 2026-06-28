param(
    [int[]]$Region = @(0, 0, 1920, 1080),
    [ValidateRange(1, 120)][int]$Fps = 60,
    [ValidateRange(500, 100000)][int]$BitrateKbps = 12000,
    [ValidatePattern("^[a-zA-Z0-9_-]+$")][string]$StreamName = "ai",
    [string]$AdditionalHost = ""
)

$ErrorActionPreference = "Stop"
if ($Region.Count -ne 4) {
    throw "Region must be LEFT,TOP,WIDTH,HEIGHT. Example: -Region 0,0,1920,1080"
}

function Find-Executable([string]$Name, [string]$FallbackRoot) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }
    $Found = Get-ChildItem $FallbackRoot -Filter "$Name.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Found) { return $Found.FullName }
    throw "$Name.exe was not found. Run runtime\windows\setup_watch_stream.ps1 first."
}

$Tools = Join-Path $PWD "tools\windows-stream"
$MediaMTX = Find-Executable "mediamtx" $Tools
$FFmpeg = Find-Executable "ffmpeg" "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
$Config = Join-Path $Tools "mediamtx-watch.yml"
$AdditionalHosts = if ($AdditionalHost) { "[$AdditionalHost]" } else { "[]" }

@"
logLevel: warn
rtsp: true
rtspAddress: 127.0.0.1:8554
rtspTransports: [tcp]
rtmp: false
hls: false
srt: false
moq: false
webrtc: true
webrtcAddress: :8889
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: $AdditionalHosts
paths:
  $StreamName:
    source: publisher
"@ | Set-Content $Config -Encoding ascii

$Addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } |
    Select-Object -ExpandProperty IPAddress -Unique

Write-Host "Viewer URLs:"
Write-Host "  http://localhost:8889/$StreamName"
foreach ($Address in $Addresses) {
    Write-Host "  http://${Address}:8889/$StreamName"
}
Write-Host ""
Write-Host "NVENC stream: ${Fps} FPS, ${BitrateKbps} kbps. Ctrl+C stops it."

$Server = Start-Process -FilePath $MediaMTX -ArgumentList "`"$Config`"" -WorkingDirectory $Tools -PassThru -NoNewWindow
Start-Sleep -Milliseconds 700

$Left, $Top, $Width, $Height = $Region
$FFmpegArgs = @(
    "-hide_banner", "-loglevel", "warning",
    "-f", "gdigrab", "-framerate", "$Fps", "-draw_mouse", "0",
    "-offset_x", "$Left", "-offset_y", "$Top", "-video_size", "${Width}x${Height}",
    "-i", "desktop",
    "-an", "-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll",
    "-rc", "cbr", "-b:v", "${BitrateKbps}k", "-maxrate", "${BitrateKbps}k",
    "-bufsize", "${BitrateKbps}k", "-g", "$Fps", "-bf", "0", "-pix_fmt", "yuv420p",
    "-rtsp_transport", "tcp", "-f", "rtsp", "rtsp://127.0.0.1:8554/$StreamName"
)

try {
    & $FFmpeg @FFmpegArgs
} finally {
    Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
}
