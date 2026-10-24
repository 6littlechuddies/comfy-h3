# H3 Studio on your PC: one-time setup (run "1 - Setup (run once).bat").
# Finds ComfyUI Desktop (it must be OPEN while this runs), adds the custom nodes the Studio uses, downloads the picture
# models into ComfyUI's model folders, and writes config.json for "2 - Start Studio.bat". Safe to run again: anything already
# there is skipped, half-finished downloads resume.
# "Continue": Windows PowerShell treats programs writing warnings as errors otherwise; failures are checked one by one
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Say($t, $c = "White") { Write-Host $t -ForegroundColor $c }
# everything this window shows also goes to setup-log.txt (send that file to Claude if anything goes wrong)
try { Start-Transcript -Path (Join-Path $here "setup-log.txt") -Force | Out-Null } catch { }

Say "`n=== H3 Studio - setup on your PC ===`n" Cyan

# ---------------------------------------------------------------- 1. find ComfyUI and its folders
$comfy = $null
foreach ($p in @("8000", "8188", "8001")) {
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://127.0.0.1:$p/system_stats"; if ($r.Content -match "devices") { $comfy = "http://127.0.0.1:$p"; break } } catch { }
}
if (-not $comfy) { Say "Open the ComfyUI app first (and wait until it has loaded), then run this again." Red; exit 1 }
$all = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "main\.py" -and $_.ExecutablePath -match "python" }
$proc = ($all | Where-Object { $_.CommandLine -match "ComfyUI" } | Select-Object -First 1); if (-not $proc) { $proc = $all | Select-Object -First 1 }
if (-not $proc) { Say "Couldn't find ComfyUI's Python - is the ComfyUI app open?" Red; exit 1 }
$py = $proc.ExecutablePath
$cmd = $proc.CommandLine
function Arg($name) { if ($cmd -match "--$name\s+(""[^""]+""|\S+(?:\s(?!--)\S+)*)") { return $Matches[1].Trim('"').Trim() } return $null }
$inputDir = Arg "input-directory"
$outputDir = Arg "output-directory"
$yamlPath = Arg "extra-model-paths-config"

# where ComfyUI itself is: the folder with main.py next to its Python (...\ComfyUI\.venv\Scripts\python.exe)
$comfyDir = $null
$up = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $py))
foreach ($c in @($up, (Join-Path $up "ComfyUI"), (Split-Path -Parent $up))) { if ($c -and (Test-Path (Join-Path $c "main.py"))) { $comfyDir = $c; break } }
if (-not $comfyDir) { $comfyDir = $up }

# ComfyUI Desktop's model-paths file: base_path + one line per folder type
$base = $null; $map = @{}
if ($yamlPath -and (Test-Path $yamlPath)) {
  foreach ($line in Get-Content $yamlPath) {
    if ($line -match "^\s+base_path:\s*(.+)$") { if (-not $base) { $base = $Matches[1].Trim().Trim('"').Trim("'") } }
    elseif ($line -match "^\s+([A-Za-z_]+):\s*(.+)$") { $k = $Matches[1]; if ($k -ne "is_default" -and -not $map.ContainsKey($k)) { $map[$k] = ($Matches[2].Trim().Trim('"').Trim("'") -split "\|")[0].Trim() } }
  }
}
function Resolve($rel) {
  if (-not $rel) { return $null }; if ([System.IO.Path]::IsPathRooted($rel)) { return $rel }
  if ($base) { if ((Split-Path -Leaf $base.TrimEnd("\", "/")) -ieq "models" -and $rel -match "^models[\\/]") { $rel = $rel.Substring(7) }; return (Join-Path $base $rel) }
  return (Join-Path $comfyDir $rel)
}
$modelsDir = $null
if ($map["checkpoints"]) { $modelsDir = Split-Path -Parent ((Resolve $map["checkpoints"]).TrimEnd("\", "/")) }
if (-not $modelsDir -and $base) {
  # base_path is either the models folder itself (…\ComfyUI-Shared\models) or the folder that holds it
  $leaf = Split-Path -Leaf $base.TrimEnd("\", "/")
  if ($leaf -ieq "models" -or (Test-Path (Join-Path $base "checkpoints")) -or (Test-Path (Join-Path $base "diffusion_models"))) { $modelsDir = $base.TrimEnd("\", "/") }
  else { $modelsDir = Join-Path $base "models" }
}
if ((Split-Path -Leaf $modelsDir) -ieq "models" -and (Split-Path -Leaf (Split-Path -Parent $modelsDir)) -ieq "models") { $modelsDir = Split-Path -Parent $modelsDir }
if (-not $modelsDir) { $modelsDir = Join-Path $comfyDir "models" }
$nodesDir = if ($map["custom_nodes"]) { (Resolve $map["custom_nodes"]).TrimEnd("\", "/") } else { Join-Path $comfyDir "custom_nodes" }
function Folder($sub) {
  $p = $null
  if ($map[$sub]) { $p = (Resolve $map[$sub]).TrimEnd("\", "/") } else { $p = Join-Path $modelsDir $sub }
  New-Item -ItemType Directory -Force -Path $p | Out-Null; return $p
}
New-Item -ItemType Directory -Force -Path $modelsDir, $nodesDir | Out-Null
if (-not $inputDir) { $inputDir = Join-Path $comfyDir "input" }
if (-not $outputDir) { $outputDir = Join-Path $comfyDir "output" }
Say "ComfyUI:          $comfy  ($comfyDir)"
Say "ComfyUI's Python: $py"
Say "Model-paths file: $yamlPath  (base: $base)"
Say "Models:           $modelsDir"
Say "Custom nodes:     $nodesDir"
Say "Pictures in/out:  $inputDir  /  $outputDir"
if (-not (Test-Path $nodesDir) -or -not (Test-Path $modelsDir)) { Say "Couldn't work out ComfyUI's folders - send Claude this window's text." Red; exit 1 }

# ---------------------------------------------------------------- 2. custom nodes (picture side only)
Say "`n--- Custom nodes ---" Cyan
$nodes = @(
  @{ repo = "lbouaraba/comfyui-krea2edit"; ref = "13ef60f20828949becada815d3cbc371eb5ccaab" },
  @{ repo = "capitan01R/ComfyUI-Krea2T-Enhancer"; ref = "02db4defe5483c8f5aacc0a9a7baa647916149c0" },
  @{ repo = "kijai/ComfyUI-KJNodes"; ref = "HEAD" },
  @{ repo = "1038lab/ComfyUI-RMBG"; ref = "HEAD" },
  @{ repo = "rgthree/rgthree-comfy"; ref = "HEAD" },
  @{ repo = "cubiq/ComfyUI_IPAdapter_plus"; ref = "a0f451a5113cf9becb0847b92884cb10cbdec0ef" },
  @{ repo = "molbal/ComfyUI-GGUF"; ref = "HEAD" }   # loads the compressed Krea 2 that fits a 16 GB card
)
$pipOk = $true
& $py -m pip --version *> $null; if ($LASTEXITCODE -ne 0) { & $py -m ensurepip --upgrade *> $null; & $py -m pip --version *> $null; if ($LASTEXITCODE -ne 0) { $pipOk = $false } }
$tmp = Join-Path $env:TEMP "h3-setup"; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
foreach ($n in $nodes) {
  $name = $n.repo.Split("/")[1]; $dest = Join-Path $nodesDir $name
  if (Test-Path $dest) { Say "  $name - already there"; continue }
  Say "  $name - downloading"
  $zip = Join-Path $tmp "$name.zip"
  & curl.exe -sL --fail -o $zip "https://github.com/$($n.repo)/archive/$($n.ref).zip"
  if ($LASTEXITCODE -ne 0 -and $n.ref -ne "HEAD") { & curl.exe -sL --fail -o $zip "https://github.com/$($n.repo)/archive/HEAD.zip" }
  if ($LASTEXITCODE -ne 0) { Say "    couldn't download $name - skipped (install it from ComfyUI's Manager)" Yellow; continue }
  $x = Join-Path $tmp "x_$name"; if (Test-Path $x) { Remove-Item -Recurse -Force $x }
  $ProgressPreference = "SilentlyContinue"
  Expand-Archive -Path $zip -DestinationPath $x -Force
  $inner = Get-ChildItem $x -Directory | Select-Object -First 1
  Move-Item $inner.FullName $dest
  $req = Join-Path $dest "requirements.txt"
  if ((Test-Path $req) -and $pipOk) {
    # never let a custom node swap out ComfyUI's AMD (ROCm) PyTorch for a different one
    $keep = Get-Content $req | Where-Object { $_ -notmatch "^\s*(torch|torchvision|torchaudio|xformers|onnxruntime-gpu|triton)\b" }
    $keep = @($keep | Where-Object { $_.Trim() -ne "" -and -not $_.TrimStart().StartsWith("#") })
    if ($keep.Count -eq 0) { continue }   # nothing to install (e.g. rgthree)
    $req2 = Join-Path $tmp "req_$name.txt"; $keep | Set-Content $req2
    & $py -m pip install -q -r $req2
    if ($LASTEXITCODE -ne 0) { Say "    some of $name's extras didn't install - it may still work" Yellow }
  }
}
if (-not $pipOk) { Say "  (pip isn't available in ComfyUI's Python - install the nodes' extras from ComfyUI's Manager if a node shows as missing)" Yellow }

# ---------------------------------------------------------------- 3. picture models
Say "`n--- Picture models (Krea 2, Krea 2 Edit, SAM 3) ---" Cyan
$want = @("image", "krea_te", "kedit", "kedit2", "sam", "krea_gguf")
$token = $null
$tokFile = Join-Path $here "hf_tokens.txt"
if (Test-Path $tokFile) { $m = [regex]::Matches((Get-Content $tokFile -Raw), "hf_[A-Za-z0-9]{20,}"); if ($m.Count) { $token = $m[0].Value } }  # first key anywhere in the file (any layout)
$group = $null
$lists = @(Get-Content (Join-Path $here "models.txt"))
if (Test-Path (Join-Path $here "models_local.txt")) { $lists += Get-Content (Join-Path $here "models_local.txt") }
foreach ($line in $lists) {
  if ($line -match "^#\s*@group\s+(\S+)") { $group = $Matches[1]; continue }
  if (-not $group -or ($want -notcontains $group) -or $line.Trim() -eq "" -or $line.TrimStart().StartsWith("#")) { continue }
  $parts = $line.Trim() -split "\s+"
  if ($parts.Count -lt 2) { continue }
  $sub = $parts[0]; $url = $parts[1]
  $file = if ($parts.Count -gt 2 -and $parts[2] -notmatch "=") { $parts[2] } else { [uri]::UnescapeDataString(($url -split "/")[-1].Split("?")[0]) }
  $dir = Folder $sub
  if (-not $dir -or -not (Test-Path $dir)) { Say "  $file - no folder for it, skipped" Yellow; continue }
  $out = Join-Path $dir $file
  if (Test-Path $out) { Say "  $file - already there"; continue }
  Say "  $file - downloading (big files take a while; you can close this and run it again later, it picks up where it left off)"
  $cargs = @("-L", "--fail", "-C", "-", "-o", "$out.part", $url)
  if ($token -and $url -match "huggingface\.co") { $cargs = @("-H", "Authorization: Bearer $token") + $cargs }
  & curl.exe @cargs
  if ($LASTEXITCODE -eq 0) { Move-Item -Force "$out.part" $out } else { Say "    $file didn't finish - run setup again to resume" Yellow }
}

# ---------------------------------------------------------------- rclone (Proton Drive: your characters and backups, like on the rental)
if (-not (Test-Path (Join-Path $here "rclone.exe"))) {
  Say "`n--- rclone (for Proton Drive) ---" Cyan
  $rz = Join-Path $tmp "rclone.zip"
  & curl.exe -sL --fail -o $rz "https://downloads.rclone.org/rclone-current-windows-amd64.zip"
  if ($LASTEXITCODE -eq 0) {
    $ProgressPreference = "SilentlyContinue"
    $rx = Join-Path $tmp "rclone"; if (Test-Path $rx) { Remove-Item -Recurse -Force $rx }
    Expand-Archive -Path $rz -DestinationPath $rx -Force
    $exe = Get-ChildItem $rx -Recurse -Filter rclone.exe | Select-Object -First 1
    if ($exe) { Copy-Item $exe.FullName (Join-Path $here "rclone.exe"); Say "  rclone - installed" }
  } else { Say "  couldn't download rclone - Proton Drive backups won't work on this PC" Yellow }
}

# ---------------------------------------------------------------- 4. config for the start file
$state = Join-Path $env:LOCALAPPDATA "H3Studio\state"; New-Item -ItemType Directory -Force -Path $state | Out-Null
$cfg = [ordered]@{ python = $py; comfy = $comfy; models = $modelsDir; input = $inputDir; output = $outputDir; state = $state; comfy_dir = $comfyDir }
$cfg | ConvertTo-Json | Set-Content (Join-Path $here "config.json") -Encoding UTF8
try { Stop-Transcript | Out-Null } catch { }
Say "`nDone. Restart the ComfyUI app once (so it loads the new nodes), then double-click ""2 - Start Studio.bat"".`n" Green
