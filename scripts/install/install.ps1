param(
  [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

function Normalize-Version {
  param([string]$RequestedVersion)

  if (-not $RequestedVersion) {
    return "latest"
  }

  switch ($RequestedVersion.ToLowerInvariant()) {
    "latest" { return "latest" }
    "stable" { return "latest" }
    "edge" { throw "The edge channel has been removed. Use the default installer for the latest tagged release or pass an exact version." }
    default { return $RequestedVersion.TrimStart("v") }
  }
}

function Resolve-LatestReleaseVersion {
  $page = Invoke-WebRequest -Uri "https://github.com/getcompanion-ai/feynman/releases/latest"
  $match = [regex]::Match($page.Content, 'releases/tag/v([0-9][^"''<>\s]*)')
  if (-not $match.Success) {
    throw "Failed to resolve the latest Feynman release version."
  }

  return $match.Groups[1].Value
}

function Resolve-ReleaseMetadata {
  param(
    [string]$RequestedVersion,
    [string]$AssetTarget,
    [string]$BundleExtension
  )

  $normalizedVersion = Normalize-Version -RequestedVersion $RequestedVersion

  if ($normalizedVersion -eq "latest") {
    $resolvedVersion = Resolve-LatestReleaseVersion
  } else {
    $resolvedVersion = $normalizedVersion
  }

  $bundleName = "feynman-$resolvedVersion-$AssetTarget"
  $archiveName = "$bundleName.$BundleExtension"
  $baseUrl = if ($env:FEYNMAN_INSTALL_BASE_URL) { $env:FEYNMAN_INSTALL_BASE_URL } else { "https://github.com/getcompanion-ai/feynman/releases/download/v$resolvedVersion" }

  return [PSCustomObject]@{
    ResolvedVersion = $resolvedVersion
    BundleName = $bundleName
    ArchiveName = $archiveName
    DownloadUrl = "$baseUrl/$archiveName"
  }
}

function Get-ArchSuffix {
  # Prefer PROCESSOR_ARCHITECTURE which is always available on Windows.
  # RuntimeInformation::OSArchitecture requires .NET 4.7.1+ and may not
  # be loaded in every Windows PowerShell 5.1 session.
  $envArch = $env:PROCESSOR_ARCHITECTURE
  if ($envArch) {
    switch ($envArch) {
      "AMD64" { return "x64" }
      "ARM64" { return "arm64" }
    }
  }

  try {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch.ToString()) {
      "X64" { return "x64" }
      "Arm64" { return "arm64" }
    }
  } catch {}

  throw "Unsupported architecture: $envArch"
}

$archSuffix = Get-ArchSuffix
$assetTarget = "win32-$archSuffix"
$release = Resolve-ReleaseMetadata -RequestedVersion $Version -AssetTarget $assetTarget -BundleExtension "zip"
$resolvedVersion = $release.ResolvedVersion
$bundleName = $release.BundleName
$archiveName = $release.ArchiveName
$downloadUrl = $release.DownloadUrl

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\feynman"
$installBinDir = Join-Path $installRoot "bin"
$bundleDir = Join-Path $installRoot $bundleName

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("feynman-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
  $archivePath = Join-Path $tmpDir $archiveName
  Write-Host "==> Downloading $archiveName"
  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
  } catch {
    throw @"
Failed to download $archiveName from:
  $downloadUrl

The win32-$archSuffix bundle is missing from the GitHub release.
This usually means the release exists, but not all platform bundles were uploaded.

Workarounds:
  - try again after the release finishes publishing
  - install via pnpm instead: pnpm add -g @companion-ai/feynman
  - install via bun instead: bun add -g @companion-ai/feynman
"@
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  if (Test-Path $bundleDir) {
    Remove-Item -Recurse -Force $bundleDir
  }

  Write-Host "==> Extracting $archiveName"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot -Force

  New-Item -ItemType Directory -Path $installBinDir -Force | Out-Null

  $shimPath = Join-Path $installBinDir "feynman.cmd"
  $shimPs1Path = Join-Path $installBinDir "feynman.ps1"
  Write-Host "==> Linking feynman into $installBinDir"
  @"
@echo off
CALL "$bundleDir\feynman.cmd" %*
"@ | Set-Content -Path $shimPath -Encoding ASCII

  @"
`$BundleDir = "$bundleDir"
& "`$BundleDir\node\node.exe" "`$BundleDir\app\bin\feynman.js" @args
"@ | Set-Content -Path $shimPs1Path -Encoding UTF8

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $alreadyOnPath = $false
  if ($currentUserPath) {
    $alreadyOnPath = $currentUserPath.Split(';') -contains $installBinDir
  }
  if (-not $alreadyOnPath) {
    $updatedPath = if ([string]::IsNullOrWhiteSpace($currentUserPath)) {
      $installBinDir
    } else {
      "$currentUserPath;$installBinDir"
    }
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")
    Write-Host "Updated user PATH. Open a new shell to run feynman."
  } else {
    Write-Host "$installBinDir is already on PATH."
  }

  $resolvedCommand = Get-Command feynman -ErrorAction SilentlyContinue
  if ($resolvedCommand -and $resolvedCommand.Source -ne $shimPath) {
    Write-Warning "Current shell resolves feynman to $($resolvedCommand.Source)"
    Write-Host "Run in a new shell, or run: `$env:Path = '$installBinDir;' + `$env:Path"
    Write-Host "Then run: feynman"
    if ($resolvedCommand.Source -like "*node_modules*@companion-ai*feynman*") {
      Write-Host "If that path is an old global npm install, remove it with: npm uninstall -g @companion-ai/feynman"
    }
  }

  Write-Host "Feynman $resolvedVersion installed successfully."
} finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Recurse -Force $tmpDir
  }
}
