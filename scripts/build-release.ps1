param(
    [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$Repository = 'makhmalatifovsafo-arch/Softech-game-club',
    [string]$Dotnet = 'dotnet',
    [string]$Node = 'node'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$releaseDir = Join-Path $projectRoot "Releases/v$Version"
if (Test-Path -LiteralPath $releaseDir) { throw "Release directory already exists: $releaseDir. Use a new version." }
$work = Join-Path $projectRoot ('.tools/package-work/' + [guid]::NewGuid().ToString('N'))
$client = Join-Path $work 'client'
$server = Join-Path $work 'server'
$helper = Join-Path $work 'helper'
New-Item -ItemType Directory -Force -Path $work,$client,$server,$helper | Out-Null
function Publish-App([string]$Project,[string]$Output,[bool]$SingleFile = $true) {
    # Keep PublishDir relative: MSBuild item transforms cannot safely interpolate
    # an absolute output path containing an apostrophe (e.g. Designer's profile).
    $depth = ($Project.Replace('\','/').Split('/').Length - 1)
    $relativeOutput = ('../' * $depth) + $Output.Substring($projectRoot.Length + 1).Replace('\','/') + '/'
    & $Dotnet publish $Project -c Release -r win-x64 --self-contained true "-p:PublishDir=$relativeOutput" --nologo -v minimal "-p:Version=$Version" "-p:AssemblyVersion=$Version.0" "-p:FileVersion=$Version.0" "-p:PublishSingleFile=$($SingleFile.ToString().ToLowerInvariant())" -p:IncludeNativeLibrariesForSelfExtract=true
    if ($LASTEXITCODE -ne 0) { throw "Publish failed: $Project" }
}
Publish-App 'SoftechUpdater/SoftechUpdater.csproj' $helper
Publish-App 'NetCafeClient/NetCafeClient.csproj' $client $false
Publish-App 'NetCafeServer/Launcher/SoftechCockpit.csproj' $server $false
Publish-App 'NetCafeServer/Service/SoftechService.csproj' (Join-Path $work 'service')
Copy-Item -LiteralPath (Join-Path $work 'service/SoftechService.exe') -Destination $server -Force
Copy-Item -LiteralPath (Join-Path $helper 'SoftechUpdater.exe') -Destination $client -Force
Copy-Item -LiteralPath (Join-Path $helper 'SoftechUpdater.exe') -Destination $server -Force
foreach ($item in @('src','public','schema.sql','start_server.bat','start-server.bat','start_server_background.vbs','diagnose-connection.mjs','diagnose-connection.cmd')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "NetCafeServer/$item") -Destination $server -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'NetCafeServer/Launcher/app.ico') -Destination $server
# Exact dependencies already installed by npm ci, with no development machine configuration.
Copy-Item -LiteralPath (Join-Path $projectRoot 'node_modules') -Destination $server -Recurse
New-Item -ItemType Directory -Path (Join-Path $server 'runtime') | Out-Null
$nodePath = (& $Node -p 'process.execPath').Trim()
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $server 'runtime/node.exe')
$utf8 = New-Object System.Text.UTF8Encoding($false)
& $Node scripts/package-metadata.mjs $server $Version
if ($LASTEXITCODE -ne 0) { throw 'Package metadata failed' }
$feed = "https://github.com/$Repository/releases/latest/download/version.json"
$clientConfig = @{ serverUrl='ws://127.0.0.1:5000/ws'; pcNumber='PC-01'; heartbeatIntervalSeconds=5; updateManifestUrl=$feed; updateIdleSeconds=10 }
$serverConfig = @{ cloudUrl='https://softech-game-club.vercel.app'; updateManifestUrl=$feed; updateIdleSeconds=10 }
[IO.File]::WriteAllText((Join-Path $client 'config.json'), ($clientConfig | ConvertTo-Json), $utf8)
[IO.File]::WriteAllText((Join-Path $server 'config.json'), ($serverConfig | ConvertTo-Json), $utf8)
function Write-PackageManifest([string]$Folder,[string]$Kind) {
    $fileHashes = [ordered]@{}
    Get-ChildItem -LiteralPath $Folder -File -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($Folder.Length + 1).Replace('\','/')
        if ($relative -ne 'config.json' -and -not $relative.EndsWith('.pdb') -and $relative -ne 'update-package.json') {
            $fileHashes[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [IO.File]::WriteAllText((Join-Path $Folder 'update-package.json'), (@{ version=$Version; kind=$Kind; files=$fileHashes } | ConvertTo-Json -Depth 10), $utf8)
}
Write-PackageManifest $client 'client'
Write-PackageManifest $server 'server'
New-Item -ItemType Directory -Path $releaseDir | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Write-OtaZip([string]$Folder,[string]$Destination) {
    $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        Get-ChildItem -LiteralPath $Folder -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($Folder.Length + 1).Replace('\','/')
            if ($relative -ne 'config.json' -and -not $relative.EndsWith('.pdb')) {
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        }
    } finally { $archive.Dispose(); $stream.Dispose() }
}
Write-OtaZip $client (Join-Path $releaseDir 'SoftechClient.zip')
Write-OtaZip $server (Join-Path $releaseDir 'SoftechServer.zip')
$assetBase = "https://github.com/$Repository/releases/download/v$Version"
$manifest = @{
    version=$Version; releaseDate=(Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
    client=@{ downloadUrl="$assetBase/SoftechClient.zip"; sha256=(Get-FileHash -LiteralPath (Join-Path $releaseDir 'SoftechClient.zip') -Algorithm SHA256).Hash.ToLowerInvariant() }
    server=@{ downloadUrl="$assetBase/SoftechServer.zip"; sha256=(Get-FileHash -LiteralPath (Join-Path $releaseDir 'SoftechServer.zip') -Algorithm SHA256).Hash.ToLowerInvariant() }
    changelog='Server resilience, paid session continuity, safe settings recovery, diagnostics, emergency timed sessions and bounded update storage. Install ServerSetup once for the independent Windows service. Cloud diagnostics require the 20261113_server_diagnostics.sql migration.'
}
[IO.File]::WriteAllText((Join-Path $releaseDir 'version.json'), ($manifest | ConvertTo-Json -Depth 10), $utf8)
# Build bootstrap installers from the exact same versioned payloads.
Copy-Item -LiteralPath (Join-Path $releaseDir 'SoftechClient.zip') -Destination 'Installers/ClientSetup/payload.zip' -Force
Copy-Item -LiteralPath (Join-Path $releaseDir 'SoftechServer.zip') -Destination 'Installers/ServerSetup/payload.zip' -Force
Publish-App 'Installers/ClientSetup/ClientSetup.csproj' (Join-Path $work 'client-setup')
Publish-App 'Installers/ServerSetup/ServerSetup.csproj' (Join-Path $work 'server-setup')
Copy-Item -LiteralPath (Join-Path $work 'client-setup/SoftechClientSetup.exe') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $work 'server-setup/SoftechServerSetup.exe') -Destination $releaseDir
Write-Output "Release prepared: $releaseDir"
