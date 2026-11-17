# Rebuild all application icons from the website's vector mark, without network access.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$root = Split-Path $PSScriptRoot -Parent
[xml]$mark = Get-Content -LiteralPath (Join-Path $root 'assets/icons/mark.svg') -Raw
$pathData = $mark.svg.path.d
$lime = '#c8ff31'
$black = '#090a0c'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-Svg($relative, $background, $foreground, $size) {
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="{0}" height="{0}"><rect width="40" height="40" fill="{1}"/><path fill="{2}" transform="translate(7.46 6.8) scale(.66)" d="{3}"/></svg>' -f $size,$background,$foreground,$pathData
    [IO.File]::WriteAllText((Join-Path $root $relative), $svg + "`n", $utf8)
}
function Write-Png($relative, $background, $foreground, $size) {
    $visual = [Windows.Media.DrawingVisual]::new()
    $context = $visual.RenderOpen()
    $context.PushTransform([Windows.Media.ScaleTransform]::new($size/40.0,$size/40.0))
    $context.DrawRectangle([Windows.Media.BrushConverter]::new().ConvertFromString($background),$null,[Windows.Rect]::new(0,0,40,40))
    $geometry = [Windows.Media.Geometry]::Parse($pathData).Clone()
    $geometry.Transform = [Windows.Media.MatrixTransform]::new(.66,0,0,.66,7.46,6.8)
    $context.DrawGeometry([Windows.Media.BrushConverter]::new().ConvertFromString($foreground),$null,$geometry)
    $context.Close()
    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new($size,$size,96,96,[Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create((Join-Path $root $relative))
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
}
# The mark stays inside the maskable icon safe circle; backgrounds cover the full canvas.
Write-Svg 'public/mobile/icon.svg' $black $lime 192
Write-Svg 'NetCafeServer/public/brand-icon.svg' $black $lime 192
foreach ($size in @(180,192,512)) {
    Write-Png "public/mobile/icon-$size.png" $black $lime $size
    Write-Png "public/icons/icon-$size.png" $lime $black $size
}
foreach ($size in @(192,512)) { Write-Svg "public/icons/icon-$size.svg" $lime $black $size }
Write-Png 'assets/icons/softech-server.png' $black $lime 1024
Write-Png 'assets/icons/softech-client.png' $black $lime 1024
Write-Png 'assets/icons/softech-admin.png' $lime $black 1024
& (Join-Path $PSScriptRoot 'build-windows-icon.ps1') -Source (Join-Path $root 'assets/icons/softech-server.png') -Destination (Join-Path $root 'NetCafeServer/app.ico')
Copy-Item -LiteralPath (Join-Path $root 'NetCafeServer/app.ico') -Destination (Join-Path $root 'NetCafeServer/Launcher/app.ico')
Copy-Item -LiteralPath (Join-Path $root 'NetCafeServer/app.ico') -Destination (Join-Path $root 'NetCafeClient/app.ico')
Write-Output 'Brand icons rebuilt. Run node scripts/sync-cloud.mjs to update the cloud mirror.'
