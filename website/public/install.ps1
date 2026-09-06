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
  $page = Invoke-WebRequest `
    -Uri "https://github.com/advaitpaliwal/feynman/releases/latest" `
    -UseBasicParsing
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
  $baseUrl = if ($env:FEYNMAN_INSTALL_BASE_URL) { $env:FEYNMAN_INSTALL_BASE_URL } else { "https://github.com/advaitpaliwal/feynman/releases/download/v$resolvedVersion" }

  return [PSCustomObject]@{
    ResolvedVersion = $resolvedVersion
    BundleName = $bundleName
    ArchiveName = $archiveName
    DownloadUrl = "$baseUrl/$archiveName"
    ChecksumsUrl = "$baseUrl/SHA256SUMS"
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
      # The release currently ships the Windows x64 bundle. Windows 11 on Arm
      # runs that bundle through its supported x64 emulation layer.
      "ARM64" { return "x64" }
    }
  }

  try {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch.ToString()) {
      "X64" { return "x64" }
      "Arm64" { return "x64" }
    }
  } catch {}

  throw "Unsupported architecture: $envArch"
}

function New-SameVolumeStagingRoot {
  param([string]$InstallRoot)

  $installFullPath = [System.IO.Path]::GetFullPath($InstallRoot)
  $installVolumeRoot = [System.IO.Path]::GetPathRoot($installFullPath)
  $stagingParent = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
  $stagingVolumeRoot = [System.IO.Path]::GetPathRoot($stagingParent)
  if (
    [string]::IsNullOrWhiteSpace($installVolumeRoot) -or
    -not [string]::Equals(
      $installVolumeRoot,
      $stagingVolumeRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "Installer staging must be on the same volume as $InstallRoot."
  }

  for ($attempt = 1; $attempt -le 32; $attempt += 1) {
    $name = "feynman-stage-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 12)
    $candidate = Join-Path $stagingParent $name
    try {
      $created = New-Item -ItemType Directory -Path $candidate -ErrorAction Stop
      return $created.FullName
    } catch {
      if (-not (Test-Path -LiteralPath $candidate)) {
        throw
      }
    }
  }

  throw "Could not allocate a unique same-volume installer staging directory."
}

function Mount-ShortStagingDrive {
  param([string]$TargetPath)

  for ($code = [int][char]"Z"; $code -ge [int][char]"D"; $code -= 1) {
    $letter = ([char]$code).ToString()
    $drive = "${letter}:"
    if (Get-PSDrive -Name $letter -PSProvider FileSystem -ErrorAction SilentlyContinue) {
      continue
    }

    & subst.exe $drive $TargetPath 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $driveRoot = "$drive\"
      if (Test-Path -LiteralPath $driveRoot) {
        return $driveRoot
      }
      & subst.exe $drive /D 2>$null | Out-Null
    }
  }

  throw "Could not allocate a temporary drive for safe Windows ZIP extraction."
}

function Dismount-ShortStagingDrive {
  param([string]$DriveRoot)

  if (-not $DriveRoot) {
    return
  }

  $drive = $DriveRoot.Substring(0, 2)
  $lastExitCode = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    & subst.exe $drive /D 2>$null | Out-Null
    $lastExitCode = $LASTEXITCODE
    if ($lastExitCode -eq 0 -or -not (Test-Path -LiteralPath $DriveRoot)) {
      return
    }
    if ($attempt -lt 5) {
      Start-Sleep -Milliseconds (100 * $attempt)
    }
  }

  throw "Could not remove temporary staging drive $drive (exit $lastExitCode)."
}

function Remove-PathWithRetry {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  $lastError = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    try {
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      }
      if (-not (Test-Path -LiteralPath $Path)) {
        return
      }
      $lastError = New-Object System.IO.IOException -ArgumentList (
        "Path still exists after cleanup attempt ${attempt}: $Path"
      )
    } catch {
      $lastError = $_
    }
    if ($attempt -lt 5) {
      Start-Sleep -Milliseconds (100 * $attempt)
    }
  }

  throw $lastError
}

function Restore-ProcessEnvironmentVariable {
  param(
    [string]$Name,
    [AllowNull()]
    [string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

$archSuffix = Get-ArchSuffix
$assetTarget = "win32-$archSuffix"
$release = Resolve-ReleaseMetadata -RequestedVersion $Version -AssetTarget $assetTarget -BundleExtension "zip"
$resolvedVersion = $release.ResolvedVersion
$bundleName = $release.BundleName
$archiveName = $release.ArchiveName
$downloadUrl = $release.DownloadUrl
$checksumsUrl = $release.ChecksumsUrl

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\feynman"
$installBinDir = Join-Path $installRoot "bin"
$bundleDir = Join-Path $installRoot $bundleName

$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$stagingPhysicalRoot = $null
$shortStagingRoot = $null
$extractRoot = $null
$primaryError = $null

try {
  $stagingPhysicalRoot = New-SameVolumeStagingRoot -InstallRoot $installRoot
  $shortStagingRoot = Mount-ShortStagingDrive -TargetPath $stagingPhysicalRoot
  $shortTempRoot = Join-Path $shortStagingRoot "tmp"
  $workRoot = Join-Path $shortStagingRoot "work"
  $extractRoot = Join-Path $shortStagingRoot "extract"
  foreach ($directory in @($shortTempRoot, $workRoot, $extractRoot)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $env:TEMP = $shortTempRoot
  $env:TMP = $shortTempRoot

  # The native ZIP contains valid paths up to 241 characters before a
  # destination prefix is added. Extract through the temporary DOS drive so
  # every path passed to the legacy Windows APIs stays below MAX_PATH. The
  # backing directory lives beside LOCALAPPDATA on the install volume so the
  # final directory swaps remain same-volume atomic renames.
  $archivePath = Join-Path $workRoot $archiveName
  $checksumsPath = Join-Path $workRoot "SHA256SUMS"
  $extractedBundleDir = Join-Path $extractRoot $bundleName
  $physicalExtractRoot = Join-Path $stagingPhysicalRoot "extract"
  $extractedBundlePhysicalDir = Join-Path $physicalExtractRoot $bundleName
  Write-Host "==> Downloading $archiveName"
  try {
    Invoke-WebRequest `
      -Uri $downloadUrl `
      -OutFile $archivePath `
      -UseBasicParsing
  } catch {
    throw @"
Failed to download $archiveName from:
  $downloadUrl

The win32-$archSuffix bundle is missing from the GitHub release.
This usually means the release exists, but not all platform bundles were uploaded.

Workarounds:
  - try again after the release finishes publishing
  - pass the latest published version explicitly, e.g.:
    & ([scriptblock]::Create((irm https://feynman.is/install.ps1))) -Version 0.2.31
"@
  }

  Write-Host "==> Verifying $archiveName"
  Invoke-WebRequest `
    -Uri $checksumsUrl `
    -OutFile $checksumsPath `
    -UseBasicParsing
  $escapedArchiveName = [regex]::Escape($archiveName)
  $checksumMatches = @(
    Select-String `
      -LiteralPath $checksumsPath `
      -Pattern "^([0-9a-fA-F]{64})\s+\*?$escapedArchiveName$"
  )
  if ($checksumMatches.Count -eq 0) {
    throw "SHA256SUMS does not contain a valid checksum for $archiveName."
  }
  if ($checksumMatches.Count -ne 1) {
    throw "SHA256SUMS contains multiple checksum entries for $archiveName."
  }
  $expectedChecksum = $checksumMatches[0].Matches[0].Groups[1].Value.ToLowerInvariant()
  $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $expectedChecksum) {
    throw "SHA-256 mismatch for ${archiveName}: expected $expectedChecksum, found $actualChecksum."
  }

  Write-Host "==> Extracting $archiveName"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $longestEntry = $archive.Entries |
      Where-Object { -not [string]::IsNullOrEmpty($_.Name) } |
      Sort-Object { $_.FullName.Length } -Descending |
      Select-Object -First 1
    if (-not $longestEntry) {
      throw "Downloaded archive contained no files."
    }
    $longestExtractedPath = Join-Path `
      $extractRoot `
      ($longestEntry.FullName.Replace("/", "\"))
    if ($longestExtractedPath.Length -ge 260) {
      throw "Downloaded archive exceeds the Windows MAX_PATH extraction budget: $($longestExtractedPath.Length) characters."
    }
  } finally {
    $archive.Dispose()
  }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractRoot)
  if (-not (Test-Path $extractedBundleDir)) {
    throw "Downloaded archive did not contain the expected $bundleName directory."
  }
  $candidateCmd = Join-Path $extractedBundleDir "feynman.cmd"
  $candidatePs1 = Join-Path $extractedBundleDir "feynman.ps1"
  foreach ($candidate in @($candidateCmd, $candidatePs1)) {
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Downloaded archive did not contain the expected launcher: $candidate"
    }
  }
  $candidateVersionOutput = @(& $candidateCmd --version 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Downloaded launcher failed --version: $candidateCmd"
  }
  $candidateVersion = ($candidateVersionOutput | Select-Object -Last 1).ToString().Trim()
  if ($candidateVersion -ne $resolvedVersion) {
    throw "Downloaded bundle version mismatch: expected=$resolvedVersion actual=$candidateVersion"
  }
  $candidateHelp = @(& $candidateCmd --help 2>&1)
  if ($LASTEXITCODE -ne 0 -or $candidateHelp.Count -eq 0) {
    throw "Downloaded launcher failed --help: $candidateCmd"
  }

  # The public one-line installer can run under Windows PowerShell's default
  # Restricted policy because it executes an in-memory scriptblock. Validate
  # the packaged PowerShell launcher in a child host with an explicit process-
  # scoped bypass rather than invoking the downloaded .ps1 file directly.
  $powerShellExecutable = (Get-Process -Id $PID).Path
  $candidateVersionOutput = @(
    & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File $candidatePs1 --version 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Downloaded launcher failed --version: $candidatePs1"
  }
  $candidateVersion = ($candidateVersionOutput | Select-Object -Last 1).ToString().Trim()
  if ($candidateVersion -ne $resolvedVersion) {
    throw "Downloaded bundle version mismatch: expected=$resolvedVersion actual=$candidateVersion"
  }
  $candidateHelp = @(
    & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File $candidatePs1 --help 2>&1
  )
  if ($LASTEXITCODE -ne 0 -or $candidateHelp.Count -eq 0) {
    throw "Downloaded launcher failed --help: $candidatePs1"
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  $stagedBinDir = Join-Path $shortStagingRoot "candidate-bin"
  $stagedBinPhysicalDir = Join-Path $stagingPhysicalRoot "candidate-bin"
  New-Item -ItemType Directory -Path $stagedBinDir -Force | Out-Null
  $shimCandidate = Join-Path $stagedBinDir "feynman.cmd"
  @"
@echo off
CALL "$bundleDir\feynman.cmd" %*
"@ | Set-Content -Path $shimCandidate -Encoding ASCII

  $backupBundleDir = Join-Path $stagingPhysicalRoot "previous-bundle"
  $backupBundleShortDir = Join-Path $shortStagingRoot "previous-bundle"
  $backupBinDir = Join-Path $stagingPhysicalRoot "previous-bin"
  $backupBinShortDir = Join-Path $shortStagingRoot "previous-bin"
  $failedCandidateDir = Join-Path $stagingPhysicalRoot "failed-candidate"
  $failedCandidateBinDir = Join-Path $stagingPhysicalRoot "failed-candidate-bin"
  $hadPreviousBundle = Test-Path -LiteralPath $bundleDir
  $hadPreviousBin = Test-Path -LiteralPath $installBinDir
  $backupBundleMoved = $false
  $backupBinMoved = $false
  $candidateBundleInstalled = $false
  $candidateBinInstalled = $false
  try {
    if ($hadPreviousBundle) {
      Move-Item -LiteralPath $bundleDir -Destination $backupBundleDir
      $backupBundleMoved = $true
    }
    if ($env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP -eq "1") {
      throw "Injected installer failure after bundle backup."
    }
    if ($hadPreviousBin) {
      Move-Item -LiteralPath $installBinDir -Destination $backupBinDir
      $backupBinMoved = $true
    }
    Move-Item -LiteralPath $extractedBundlePhysicalDir -Destination $bundleDir
    $candidateBundleInstalled = $true
    Write-Host "==> Linking feynman into $installBinDir"
    if ($env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP -eq "1") {
      throw "Injected installer failure after bundle swap."
    }
    Move-Item -LiteralPath $stagedBinPhysicalDir -Destination $installBinDir
    $candidateBinInstalled = $true
  } catch {
    if ($candidateBundleInstalled -and (Test-Path -LiteralPath $bundleDir)) {
      Move-Item -LiteralPath $bundleDir -Destination $failedCandidateDir
    }
    if ($candidateBinInstalled -and (Test-Path -LiteralPath $installBinDir)) {
      Move-Item -LiteralPath $installBinDir -Destination $failedCandidateBinDir
    }
    if ($backupBundleMoved -and (Test-Path -LiteralPath $backupBundleDir)) {
      Move-Item -LiteralPath $backupBundleDir -Destination $bundleDir
    }
    if ($backupBinMoved -and (Test-Path -LiteralPath $backupBinDir)) {
      Move-Item -LiteralPath $backupBinDir -Destination $installBinDir
    }
    throw
  }
  Remove-PathWithRetry -Path $backupBundleShortDir
  Remove-PathWithRetry -Path $backupBinShortDir
  $staleBundleIndex = 0
  Get-ChildItem -LiteralPath $installRoot -Directory -Filter "feynman-*" |
    Where-Object { $_.FullName -ne $bundleDir } |
    ForEach-Object {
      $staleBundleIndex += 1
      Move-Item `
        -LiteralPath $_.FullName `
        -Destination (Join-Path $stagingPhysicalRoot "stale-bundle-$staleBundleIndex")
    }

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
  # Install only the CMD shim on PATH. Windows PowerShell resolves .ps1 before
  # PATHEXT launchers, so a same-name PowerShell shim is blocked by the default
  # Restricted policy before the working CMD launcher can be selected.
  $expectedShimPaths = @(
    [System.IO.Path]::GetFullPath((Join-Path $installBinDir "feynman.cmd"))
  )
  $resolvedSource = if ($resolvedCommand) { $resolvedCommand.Source } else { $null }
  $resolvedToInstalledShim = $false
  if ($resolvedSource) {
    $resolvedFullPath = [System.IO.Path]::GetFullPath($resolvedSource)
    foreach ($expectedShimPath in $expectedShimPaths) {
      if ([string]::Equals($resolvedFullPath, $expectedShimPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $resolvedToInstalledShim = $true
        break
      }
    }
  }
  if ($resolvedCommand -and -not $resolvedToInstalledShim) {
    Write-Warning "Current shell resolves feynman to $($resolvedCommand.Source)"
    Write-Host "Run in a new shell, or run: `$env:Path = '$installBinDir;' + `$env:Path"
    Write-Host "Then run: feynman"
    Write-Host "If that path is an old package-manager install, remove it or put $installBinDir first on PATH."
  }

  Write-Host "Feynman $resolvedVersion installed successfully."
} catch {
  $primaryError = $_
  throw
} finally {
  $cleanupError = $null
  try {
    Restore-ProcessEnvironmentVariable -Name "TEMP" -Value $originalTemp
  } catch {
    $cleanupError = $_
  }
  try {
    Restore-ProcessEnvironmentVariable -Name "TMP" -Value $originalTmp
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  try {
    if ($shortStagingRoot) {
      Get-ChildItem -LiteralPath $shortStagingRoot -Force -ErrorAction Stop |
        ForEach-Object { Remove-PathWithRetry -Path $_.FullName }
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  $driveDismounted = -not $shortStagingRoot
  try {
    Dismount-ShortStagingDrive -DriveRoot $shortStagingRoot
    $driveDismounted = $true
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  try {
    if ($driveDismounted) {
      Remove-PathWithRetry -Path $stagingPhysicalRoot
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }

  if ($cleanupError) {
    if ($primaryError) {
      Write-Warning "Installer cleanup also failed: $($cleanupError.Exception.Message)"
    } else {
      throw $cleanupError
    }
  }
}
