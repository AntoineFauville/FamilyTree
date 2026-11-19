# Raises the app version number in index.html (all the "?v=N" on the app's files),
# so visitors' browsers load the new files right away instead of a saved older copy.
# Run it after changing anything in js/ or css/, before committing.
# (Only for app changes: publishing the family file with publish.cmd doesn't need it.)

$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'index.html'
$html = [IO.File]::ReadAllText($path)
$m = [regex]::Match($html, '\?v=(\d+)')
if (-not $m.Success) { throw 'No ?v= version found in index.html' }
$old = [int]$m.Groups[1].Value
$new = $old + 1
$html = [regex]::Replace($html, '\?v=\d+', "?v=$new")
[IO.File]::WriteAllText($path, $html)
Write-Host "App version: $old -> $new"
