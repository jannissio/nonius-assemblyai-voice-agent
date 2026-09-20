$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (-not $request.text -or $request.text.Length -gt 1000) { throw 'Invalid speech text.' }
Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$memory = New-Object System.IO.MemoryStream
try {
  $voice = $synthesizer.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-US' -and $_.Enabled } | Select-Object -First 1
  if ($voice) { $synthesizer.SelectVoice($voice.VoiceInfo.Name) }
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synthesizer.SetOutputToAudioStream($memory, $format)
  $synthesizer.Speak([string]$request.text)
  $synthesizer.SetOutputToNull()
  $bytes = $memory.ToArray()
  $output = [Console]::OpenStandardOutput()
  $output.Write($bytes, 0, $bytes.Length)
  $output.Flush()
} finally {
  $synthesizer.Dispose()
  $memory.Dispose()
}
