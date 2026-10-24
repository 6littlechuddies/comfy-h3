# Connect Google Drive for backups (instead of Proton Drive): signs you in to Google in your browser (rclone's own sign-in),
# then writes GDRIVE_TOKEN into keys.txt here and copies the same line for your Vast template.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$rclone = Join-Path $here "rclone.exe"
if (-not (Test-Path $rclone)) { Write-Host "rclone.exe isn't here yet - run ""1 - Setup (run once).bat"" first." -ForegroundColor Red; exit 1 }
Write-Host "`nA browser window opens: sign in to the Google account whose Drive should hold your backups, and allow access.`n" -ForegroundColor Cyan
# your own Google client (recommended: rclone's shared one is being retired by Google). Leave empty to use the shared one.
$cid = (Read-Host "Your Google client ID (Enter to skip)").Trim()
$csec = ""; if ($cid) { $csec = (Read-Host "Your Google client secret").Trim() }
if ($cid) { $out = & $rclone authorize "drive" $cid $csec 2>&1 | Out-String } else { $out = & $rclone authorize "drive" 2>&1 | Out-String }
$m = [regex]::Match($out, "\{.*?""refresh_token"".*?\}", "Singleline")
if (-not $m.Success) { $m = [regex]::Match($out, "\{[^{}]*""access_token""[^{}]*\}", "Singleline") }
if (-not $m.Success) { Write-Host "Didn't get a sign-in from Google. Run this again." -ForegroundColor Red; Write-Host $out; exit 1 }
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($m.Value.Trim()))
$line = "GDRIVE_TOKEN=$b64"
$keys = Join-Path $here "keys.txt"
$old = @(); if (Test-Path $keys) { $old = @(Get-Content $keys | Where-Object { $_ -notmatch "^\s*GDRIVE_TOKEN\s*=" }) }
($old + $line) | Set-Content $keys
try { Set-Clipboard -Value $b64 } catch { }
Write-Host "`nGoogle Drive connected. keys.txt now has GDRIVE_TOKEN (backups go to Google Drive > ""H3 Studio"")." -ForegroundColor Green
Write-Host "For your rentals: in the Vast template add an environment variable  GDRIVE_TOKEN  with this value (already copied):`n" -ForegroundColor Green
if ($cid) { Write-Host "Also add  GDRIVE_CLIENT_ID = $cid  and  GDRIVE_CLIENT_SECRET = (the secret you typed)." -ForegroundColor Green }
Write-Host $b64
Write-Host "`nKeep it private - it opens your Google Drive. Restart ""2 - Start Studio.bat"" to use it here.`n"
