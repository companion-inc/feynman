param(
  [string]$Version = "latest",
  [ValidateSet("Codex", "User", "Repo", "OpenCode")]
  [string]$Scope = "Codex",
  [string]$TargetDir = ""
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
  $page = Invoke-WebRequest -Uri "https://github.com/advaitpaliwal/feynman/releases/latest"
  $match = [regex]::Match($page.Content, 'releases/tag/v([0-9][^"''<>\s]*)')
  if (-not $match.Success) {
    throw "Failed to resolve the latest Feynman release version."
  }

  return $match.Groups[1].Value
}

function Resolve-VersionMetadata {
  param([string]$RequestedVersion)

  $normalizedVersion = Normalize-Version -RequestedVersion $RequestedVersion

  if ($normalizedVersion -eq "latest") {
    $resolvedVersion = Resolve-LatestReleaseVersion
  } else {
    $resolvedVersion = $normalizedVersion
  }

  return [PSCustomObject]@{
    ResolvedVersion = $resolvedVersion
    GitRef = "v$resolvedVersion"
    DownloadUrl = if ($env:FEYNMAN_INSTALL_SKILLS_ARCHIVE_URL) { $env:FEYNMAN_INSTALL_SKILLS_ARCHIVE_URL } else { "https://github.com/advaitpaliwal/feynman/archive/refs/tags/v$resolvedVersion.zip" }
  }
}

function Resolve-InstallDir {
  param(
    [string]$ResolvedScope,
    [string]$ResolvedTargetDir
  )

  if ($ResolvedTargetDir) {
    return $ResolvedTargetDir
  }

  if ($ResolvedScope -eq "Repo") {
    return Join-Path (Get-Location) ".agents\skills\feynman"
  }
  if ($ResolvedScope -eq "OpenCode") {
    return Join-Path (Get-Location) ".opencode\skills\feynman"
  }

  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  return Join-Path $codexHome "skills\feynman"
}

$metadata = Resolve-VersionMetadata -RequestedVersion $Version
$resolvedVersion = $metadata.ResolvedVersion
$downloadUrl = $metadata.DownloadUrl
$installDir = Resolve-InstallDir -ResolvedScope $Scope -ResolvedTargetDir $TargetDir

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("feynman-skills-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
  $archivePath = Join-Path $tmpDir "feynman-skills.zip"
  $extractDir = Join-Path $tmpDir "extract"

  Write-Host "==> Downloading Feynman skills $resolvedVersion"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

  Write-Host "==> Extracting skills"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force

  $sourceRoot = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
  if (-not $sourceRoot) {
    throw "Could not find extracted Feynman archive."
  }

  $skillsSource = Join-Path $sourceRoot.FullName "skills"
  $promptsSource = Join-Path $sourceRoot.FullName "prompts"
  if (-not (Test-Path $skillsSource) -or -not (Test-Path $promptsSource)) {
    throw "Could not find the bundled skills resources in the downloaded archive."
  }

  $installParent = Split-Path $installDir -Parent
  if ($installParent) {
    New-Item -ItemType Directory -Path $installParent -Force | Out-Null
  }

  if (Test-Path $installDir) {
    Remove-Item -Recurse -Force $installDir
  }

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -Path (Join-Path $skillsSource "*") -Destination $installDir -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $installDir "prompts") -Force | Out-Null
  Copy-Item -Path (Join-Path $promptsSource "*") -Destination (Join-Path $installDir "prompts") -Recurse -Force
  Copy-Item -Path (Join-Path $sourceRoot.FullName "AGENTS.md") -Destination (Join-Path $installDir "AGENTS.md") -Force
  Copy-Item -Path (Join-Path $sourceRoot.FullName "CONTRIBUTING.md") -Destination (Join-Path $installDir "CONTRIBUTING.md") -Force

  Write-Host "==> Installed skills to $installDir"
  if ($Scope -eq "Repo") {
    Write-Host "Repo-local skills will be discovered automatically from .agents/skills."
  } elseif ($Scope -eq "OpenCode") {
    Write-Host "OpenCode project skills will be discovered from .opencode/skills."
  } else {
    Write-Host "Codex user skills will be discovered from `$CODEX_HOME/skills."
  }

  Write-Host "Feynman skills $resolvedVersion installed successfully."
} finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Recurse -Force $tmpDir
  }
}
