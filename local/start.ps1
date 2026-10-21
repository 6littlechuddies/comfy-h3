# H3 Studio on your PC: starts the Studio's helper (it serves the Studio and talks to ComfyUI Desktop) and opens it.
# "Continue": Windows PowerShell treats programs writing warnings as errors otherwise; failures are checked one by one
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgFile = Join-Path $here "config.json"
if (-not (Test-Path $cfgFile)) { Write-Host "Run ""1 - Setup (run once).bat"" first." -ForegroundColor Red; exit 1 }
$cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$($cfg.comfy)/system_stats" | Out-Null }
catch { Write-Host "ComfyUI isn't answering at $($cfg.comfy). Open the ComfyUI app, wait until it has loaded, then run this again." -ForegroundColor Yellow }
$env:H3_LOCAL = "1"
$env:STUDIO_COMFY = $cfg.comfy
$env:STUDIO_PORT = "18190"
$env:COMFY_DIR = $cfg.comfy_dir
$env:H3_MODELS = $cfg.models
$env:H3_INPUT = $cfg.input
$env:H3_OUTPUT = $cfg.output
$env:H3_TEMP = Join-Path $env:TEMP "h3-temp"
$env:H3_STATE = $cfg.state
$env:H3_WORK = Join-Path $cfg.state "..\work"
$env:H3_WORKFLOWS = Join-Path $cfg.state "workflows"
$env:H3_STUDIO_DIST = Join-Path $here "studio"
$env:H3_MODELS_TXT = Join-Path $here "models.txt"
$env:STUDIO_PROMPTS = Join-Path $here "prompts"
$env:HF_KEYS_FILE = Join-Path $here "hf_tokens.txt"
$env:PYTHONIOENCODING = "utf-8"
# keys.txt: the same settings as your Vast template, one per line (CIVITAI_TOKEN=..., PROTON_USER=..., SITE_FACTORY_TOKEN=...)
$keys = Join-Path $here "keys.txt"
if (Test-Path $keys) {
  foreach ($line in Get-Content $keys) {
    if ($line -match "^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$") { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim('"') }
  }
}
# rclone.exe (Proton Drive backups / restoring your characters) sits next to this file
$env:PATH = "$here;$env:PATH"
Start-Job -ScriptBlock { Start-Sleep 4; Start-Process "http://127.0.0.1:18190/studio/" } | Out-Null
Write-Host "H3 Studio is running - keep this window open while you use it. (Close it to stop.)" -ForegroundColor Green
& $cfg.python (Join-Path $here "studio_server.py")
