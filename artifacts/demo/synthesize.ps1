param(
    [Parameter(Mandatory = $true)][string]$Storyboard,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$plan = Get-Content -LiteralPath $Storyboard -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.Rate = 0
    $speaker.Volume = 100
    foreach ($scene in $plan.scenes) {
        $outputFile = Join-Path $OutputDirectory ("voice-" + $scene.id + ".wav")
        $speaker.SetOutputToWaveFile($outputFile)
        $speaker.Speak([string]$scene.narration)
        $speaker.SetOutputToNull()
    }
} finally {
    $speaker.Dispose()
}
