param([switch]$Check)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$taskVersion = [version]((& $taskNode --version).TrimStart('v'))
if ($taskVersion -lt [version]'22.12.0') { throw '請使用 Node.js 22.12 以上版本（建議 Node.js 24 LTS）。' }
$env:PATH = (Split-Path -Parent $taskNode) + ';' + $env:PATH
if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) { throw '請先依 README 執行 npm ci 安裝套件。' }
if ($Check) {
  & $taskNode 'node_modules\typescript\bin\tsc' -b --pretty false
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $taskNode 'node_modules\eslint\bin\eslint.js' .
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $taskNode 'node_modules\vitest\vitest.mjs' run
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $taskNode 'node_modules\vite\bin\vite.js' build
} else { & $taskNode 'node_modules\vite\bin\vite.js' --host 0.0.0.0 }
