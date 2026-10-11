$ErrorActionPreference = 'Stop'
$workspaceRoot = $PSScriptRoot
Set-Location -LiteralPath $workspaceRoot
$runtimeExe = Join-Path $workspaceRoot '.tools/python/python.exe'
$pidFile = Join-Path $workspaceRoot '.runtime/server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $priorServerId = 0
    if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$priorServerId)) {
        $priorServer = Get-CimInstance Win32_Process -Filter "ProcessId=$priorServerId" -ErrorAction SilentlyContinue
        if ($priorServer -and $priorServer.ExecutablePath -and $priorServer.CommandLine) {
            $sameRuntime = [IO.Path]::GetFullPath($priorServer.ExecutablePath) -eq [IO.Path]::GetFullPath($runtimeExe)
            $sameWorkspace = $priorServer.CommandLine.Replace('\', '/').Contains($workspaceRoot.Replace('\', '/'))
            $sameApp = $priorServer.CommandLine -match '-m\s+vibeguard\.web(?:\s|$)'
            if ($sameRuntime -and $sameWorkspace -and $sameApp) {
                Stop-Process -Id $priorServerId -Force
                Wait-Process -Id $priorServerId -ErrorAction SilentlyContinue
            }
        }
    }
}
if (Test-Path -LiteralPath $runtimeExe) {
    & $runtimeExe -m vibeguard.web --root $workspaceRoot
} else {
    python -m vibeguard.web --root $workspaceRoot
}
exit $LASTEXITCODE
