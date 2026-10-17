# Starts a dedicated Chrome profile with the DevTools protocol on loopback only.
# Log in to TradingView once in this window; use it for TradingView only.
param(
  [string]$ProfileDir = (Join-Path $PSScriptRoot "..\.chrome-profile"),
  [int]$Port = 9222,
  [string]$Url = "https://www.tradingview.com/chart/"
)
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "Chrome not found" }
& $chrome `
  --remote-debugging-port=$Port `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$ProfileDir" `
  --no-first-run `
  $Url
