# Setzt den Verwaltungs-Worker zu EINER Datei zusammen: ..\2-shirtbox-admin-worker.js
# Aufruf: powershell -ExecutionPolicy Bypass -File bauen.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text($name) { [IO.File]::ReadAllText((Join-Path $here $name), $utf8) }
# JSON-String-Literal: gültiges JavaScript, schliesst </script> und Sonderzeichen sicher ein.
function To-Literal($text) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $text.ToCharArray()) {
    $code = [int]$ch
    switch ($ch) {
      '"' { [void]$sb.Append('\"') }
      '\' { [void]$sb.Append('\\') }
      "`n" { [void]$sb.Append('\n') }
      "`r" { }
      "`t" { [void]$sb.Append('\t') }
      '<' { [void]$sb.Append('<') }
      default { if ($code -lt 32 -or $code -eq 0x2028 -or $code -eq 0x2029) { [void]$sb.Append(('\u{0:x4}' -f $code)) } else { [void]$sb.Append($ch) } }
    }
  }
  [void]$sb.Append('"')
  $sb.ToString()
}
$worker = (Read-Text 'admin-worker.js') + "`n" + (Read-Text 'buchhaltung-worker.js')
$worker = $worker.Replace('__ADMIN_HTML__', (To-Literal (Read-Text 'admin.html')))
$worker = $worker.Replace('__ADMIN_JS__', (To-Literal ((Read-Text 'admin.js') + "`n" + (Read-Text 'buchhaltung.js'))))
$worker = $worker.Replace('__ADMIN_CSS__', (To-Literal (Read-Text 'admin.css')))
$worker = $worker.Replace('__SCHEMA__', (To-Literal ([IO.File]::ReadAllText((Join-Path $here '..\1-datenbank.sql'), $utf8))))
$out = Join-Path $here '..\2-shirtbox-admin-worker.js'
[IO.File]::WriteAllText($out, $worker, $utf8)
Write-Output ("Fertig: {0} ({1:N0} KB)" -f (Resolve-Path $out), ((Get-Item $out).Length / 1KB))
