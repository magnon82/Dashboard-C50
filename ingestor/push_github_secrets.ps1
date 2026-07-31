# One-shot: sube secrets de sync en la nube a GitHub Actions.
# Requisitos: gh auth login (una vez)
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -ErrorAction SilentlyContinue
if (-not $root) { $root = (Resolve-Path "$PSScriptRoot\..").Path }
Set-Location $root

$gh = "$env:ProgramFiles\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

& $gh auth status | Out-Null

python -c @"
from pathlib import Path
from dotenv import dotenv_values
root = Path('.')
vals = dotenv_values(root / '.env.local')
d = root / '_tmp_secrets'
d.mkdir(exist_ok=True)
(d / 'NEXT_PUBLIC_SUPABASE_URL').write_text(vals.get('NEXT_PUBLIC_SUPABASE_URL') or '', encoding='utf-8')
(d / 'SUPABASE_SERVICE_ROLE_KEY').write_text(vals.get('SUPABASE_SERVICE_ROLE_KEY') or '', encoding='utf-8')
(d / 'GOOGLE_OAUTH_CLIENT_JSON').write_text((root / 'ingestor/credentials.json').read_text(encoding='utf-8'), encoding='utf-8')
(d / 'GOOGLE_OAUTH_TOKEN_JSON').write_text((root / 'ingestor/token.json').read_text(encoding='utf-8'), encoding='utf-8')
print('ok')
"@

foreach ($name in @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_OAUTH_CLIENT_JSON',
  'GOOGLE_OAUTH_TOKEN_JSON'
)) {
  Get-Content "_tmp_secrets\$name" -Raw | & $gh secret set $name
  Write-Host "OK $name"
}
Remove-Item -Recurse -Force _tmp_secrets
& $gh secret list
Write-Host "Listo. En Actions puedes Run workflow manualmente para probar."
