# Starts a dedicated Chrome profile with CDP on localhost only.
$profile = Join-Path $PSScriptRoot ".chrome-profile"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$profile" --no-first-run "https://www.tradingview.com/chart/"
