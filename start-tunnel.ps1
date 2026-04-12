# Cloudflare Tunnel Start Script for AI-Meet
# Usage: .\start-tunnel.ps1

Write-Host "Starting Cloudflare Tunnel for yumeet.site and api.yumeet.site..." -ForegroundColor Cyan
./cloudflared.exe tunnel --no-autoupdate run --protocol http2 --token eyJhIjoiNGVjZjVlYWY1OTRjZTM4NDZiNjVjY2QyZjczMjk4MTAiLCJ0IjoiMzgwYzIzMWMtOTQxYS00MmJhLTlkMTQtZGNmZTgwNjQxMjk3IiwicyI6IlpEQmxZakpsWmprdE1EQTFaUzAwWm1VMExXRXdOV010WkRneVpUbGpNek13WkRneiJ9
