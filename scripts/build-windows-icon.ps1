param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (!(Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Icon source not found: $sourcePath" }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destinationPath)) | Out-Null

$frames = foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
    $image = [Windows.Media.Imaging.BitmapImage]::new()
    $image.BeginInit()
    $image.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $image.UriSource = [Uri]::new($sourcePath)
    $image.DecodePixelWidth = $size
    $image.DecodePixelHeight = $size
    $image.EndInit()
    $image.Freeze()

    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($image))
    $memory = [IO.MemoryStream]::new()
    try {
        $encoder.Save($memory)
        [pscustomobject]@{ Size = $size; Bytes = $memory.ToArray() }
    } finally { $memory.Dispose() }
}

$file = [IO.File]::Open($destinationPath,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
$writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $writer.Write([byte]$(if ($frame.Size -eq 256) { 0 } else { $frame.Size }))
        $writer.Write([byte]$(if ($frame.Size -eq 256) { 0 } else { $frame.Size }))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally {
    $writer.Dispose()
    $file.Dispose()
}

Write-Output "Windows icon created: $destinationPath ($($frames.Count) sizes)"
