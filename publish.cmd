@echo off
rem Double-click this file to put your latest saved family tree online.
rem (Windows blocks .ps1 scripts by default; this runs publish.ps1 for this one time only.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish.ps1"
