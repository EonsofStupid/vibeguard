param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Chat', 'Review')][string]$Role,
    [ValidateSet('Auto', 'Model', 'AgentEngine')][string]$Backend = 'Auto',
    [string]$ApiUrl = '',
    [ValidateRange(0, 65535)][int]$Port = 0,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$clientRoot = Join-Path $workspaceRoot 'vibeguard'
$envFile = Join-Path $clientRoot '.env.local'
function Read-Setting([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ($value) { return $value }
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=(.*)$')) {
                return $Matches[1].Trim().Trim([char]34).Trim([char]39)
            }
        }
    }
    return ''
}
if ($Backend -eq 'Auto') {
    $Backend = if ($Role -eq 'Chat' -and (Read-Setting 'VIBEGUARD_CHAT_BACKEND') -eq 'model') { 'Model' } else { 'AgentEngine' }
}
if ($Role -eq 'Review' -and $Backend -eq 'Model') { throw 'RRFlow review requires its Agent Engine endpoint.' }
if ($Backend -eq 'Model') {
    if (-not (Read-Setting 'VIBEGUARD_MODEL_API_KEY')) { throw 'Set VIBEGUARD_MODEL_API_KEY in vibeguard/.env.local.' }
    Write-Host 'Backend: live model chat. RRFlow review and Atlas memory are not connected.'
} else {
    $configName = if ($Role -eq 'Chat') { 'VIBEGUARD_CHAT_API_URL' } else { 'RRFLOW_REVIEW_API_URL' }
    if (-not $ApiUrl) { $ApiUrl = Read-Setting $configName }
    if (-not $ApiUrl) { throw "Set $configName in vibeguard/.env.local or pass -ApiUrl." }
    $targetUri = $null
    if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$targetUri)) { throw 'The engine URL must be absolute.' }
    if ($targetUri.UserInfo -or $targetUri.Fragment) { throw 'Use an engine URL without credentials or a fragment.' }
    if ($targetUri.Scheme -ne 'https' -and -not ($targetUri.Scheme -eq 'http' -and $targetUri.IsLoopback)) { throw 'Use HTTPS or a loopback HTTP URL.' }
    if ($targetUri.AbsolutePath -notmatch '/invoke(?:Stream|/stream)?/?$') { throw 'Use the invocation URL, not the Agent Engine home page.' }
    Write-Host "Engine target: $ApiUrl"
}
if ($Port -eq 0) { $Port = if ($Role -eq 'Chat') { 3001 } else { 3002 } }
$clientPage = if ($Role -eq 'Review') { '/reviews' } else { '/' }
Write-Host "$Role client: http://127.0.0.1:$Port$clientPage"
if (-not (Test-Path -LiteralPath (Join-Path $clientRoot 'node_modules/next'))) { throw 'Install dependencies first: cd vibeguard; corepack pnpm install --frozen-lockfile' }
if ($CheckOnly) { Write-Host 'Configuration validated. No network request performed.'; exit 0 }
$priorApiUrl = $env:MONGODB_AGENTIC_API_URL
$priorRole = $env:VIBEGUARD_DASHBOARD_ROLE
$priorBackend = $env:VIBEGUARD_CHAT_BACKEND
Push-Location -LiteralPath $clientRoot
try {
    $env:MONGODB_AGENTIC_API_URL = $ApiUrl
    $env:VIBEGUARD_DASHBOARD_ROLE = $Role.ToLowerInvariant()
    $env:VIBEGUARD_CHAT_BACKEND = if ($Backend -eq 'Model') { 'model' } else { 'agentengine' }
    & corepack pnpm run dev --hostname 127.0.0.1 --port $Port
    $resultCode = $LASTEXITCODE
} finally {
    $env:MONGODB_AGENTIC_API_URL = $priorApiUrl
    $env:VIBEGUARD_DASHBOARD_ROLE = $priorRole
    $env:VIBEGUARD_CHAT_BACKEND = $priorBackend
    Pop-Location
}
exit $resultCode
