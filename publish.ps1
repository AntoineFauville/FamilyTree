# Puts your latest saved family tree online.
#
# 1. In the app: Edit mode -> make changes -> "Save encrypted file" (it lands in Downloads).
# 2. Right-click this file -> "Run with PowerShell" (or run:  .\publish.ps1  in this folder).
#
# It takes the newest family.enc*.json from Downloads, puts it in data\family.enc.json,
# then commits and pushes it to GitHub. The website updates a few minutes later.

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$downloads = Join-Path $env:USERPROFILE 'Downloads'

# Browsers name repeated downloads "family.enc (1).json", "family.enc (2).json"...
$latest = Get-ChildItem $downloads -Filter 'family.enc*.json' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $latest) {
  Write-Host "No saved family file found in $downloads." -ForegroundColor Yellow
  Write-Host 'In the app, tick Edit mode and click "Save encrypted file" first.'
  Read-Host 'Press Enter to close'
  exit 1
}

# Safety: only ever publish an encrypted file, never readable family data.
$text = Get-Content $latest.FullName -Raw
if ($text -notmatch '"format"\s*:\s*"familytree-encrypted"') {
  Write-Host "$($latest.Name) is not an encrypted family file. Nothing was published." -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host "Using $($latest.Name), saved $($latest.LastWriteTime)."
Copy-Item $latest.FullName (Join-Path $repo 'data\family.enc.json') -Force

git -C $repo add data/family.enc.json
git -C $repo diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'This is the same as what is already published. Nothing to do.' -ForegroundColor Green
} else {
  git -C $repo commit -m "Update family tree" --only data/family.enc.json
  git -C $repo push
  Write-Host 'Published. The website shows the new tree in a few minutes.' -ForegroundColor Green
}

# Tidy up so next time there is no confusion about which file is the newest.
Remove-Item $latest.FullName
Read-Host 'Press Enter to close'
