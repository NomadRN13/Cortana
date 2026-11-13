# RSVPlay - run every test suite in Docker, from Windows.
#
#   .\scripts\test-in-docker.ps1                 # all three suites
#   .\scripts\test-in-docker.ps1 -Only backend   # just one (backend | app | web)
#   .\scripts\test-in-docker.ps1 -Clean          # remove the three images afterwards
#   .\scripts\test-in-docker.ps1 -Only none -Clean   # only remove the images
#
# Why Docker: the suites need Node, Postgres 16 and a Chromium that matches
# playwright-core, and none of those need to be installed on this machine. Each
# suite runs in a throwaway container with the repo mounted READ-ONLY, so
# nothing is written into your checkout.
#
# What it leaves behind: three images, downloaded the first time (about 2.5 GB
# in total, almost all of it the Playwright one). They make every later run
# start in seconds. -Clean removes them; the next run downloads them again.
#
# If PowerShell refuses to run this file ("running scripts is disabled"), run it
# for this one invocation with:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-in-docker.ps1

param(
  [ValidateSet('backend', 'app', 'web', 'none')]
  [string[]]$Only = @('backend', 'app', 'web'),
  [switch]$Clean
)

# Deliberately not $ErrorActionPreference = 'Stop': the suites write progress to
# stderr, and Windows PowerShell turns redirected stderr from a program into a
# terminating error under 'Stop' - which would abort the run on a warning.
# Success and failure are read from each container's exit code instead.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# Keep the Playwright tag in step with tests/web/package-lock.json: the image
# ships the one Chromium build that version of playwright-core can drive.
$images = [ordered]@{
  backend = 'postgres:16'
  app     = 'node:20-slim'
  web     = 'mcr.microsoft.com/playwright:v1.62.1-noble'
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker is not installed (no docker command found). Install Docker Desktop and try again.' -ForegroundColor Red
  exit 1
}
$global:LASTEXITCODE = 1
docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker is not running. Start Docker Desktop and try again.' -ForegroundColor Red
  exit 1
}

$results = [ordered]@{}
foreach ($suite in $images.Keys) {
  if ($Only -notcontains $suite) { continue }
  Write-Host ''
  Write-Host "=== $suite suite ($($images[$suite])) ===" -ForegroundColor Cyan
  $extra = @()
  if ($suite -eq 'web') { $extra = @('--ipc=host') }
  $global:LASTEXITCODE = 1   # so a docker that never ran can't read as a pass
  docker run --rm @extra -v "${repo}:/src:ro" $images[$suite] bash -c "sed 's/\r`$//' /src/scripts/docker-suite.sh | bash -s $suite"
  $results[$suite] = $LASTEXITCODE
}

if ($results.Count -gt 0) {
  Write-Host ''
  Write-Host '=== Summary ===' -ForegroundColor Cyan
  foreach ($suite in $results.Keys) {
    if ($results[$suite] -eq 0) { Write-Host ("  PASS  {0}" -f $suite) -ForegroundColor Green }
    else { Write-Host ("  FAIL  {0}  (exit {1})" -f $suite, $results[$suite]) -ForegroundColor Red }
  }
}

if ($Clean) {
  Write-Host ''
  Write-Host '=== Removing the test images ===' -ForegroundColor Cyan
  foreach ($image in $images.Values) {
    docker image rm $image *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "  removed $image" }
    else { Write-Host "  $image was not present (or is in use)" }
  }
}

$failed = @($results.Values | Where-Object { $_ -ne 0 }).Count
exit $failed
