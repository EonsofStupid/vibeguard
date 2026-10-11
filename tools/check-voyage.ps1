$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspaceRoot
& "$workspaceRoot/.tools/python/python.exe" -c "from pathlib import Path; from vibeguard.web.server import load_env; from vibeguard.context.voyage import health; load_env(Path.cwd()); print(health())"
exit $LASTEXITCODE
