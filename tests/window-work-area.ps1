$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../NetCafeServer/Launcher/WindowWorkArea.cs')
function Check-Bounds($monitorValues, $workValues, $expected) {
    $monitor = New-Object SoftechCockpit.WindowWorkArea+Rect
    $work = New-Object SoftechCockpit.WindowWorkArea+Rect
    $monitor.Left, $monitor.Top, $monitor.Right, $monitor.Bottom = $monitorValues
    $work.Left, $work.Top, $work.Right, $work.Bottom = $workValues
    $info = New-Object SoftechCockpit.WindowWorkArea+MinMaxInfo
    $minimum = New-Object SoftechCockpit.WindowWorkArea+Point
    $minimum.X = 1800; $minimum.Y = 1200
    $info.MinTrackSize = $minimum
    $result = [SoftechCockpit.WindowWorkArea]::Fit($info, $monitor, $work)
    $actual = @($result.MaxPosition.X, $result.MaxPosition.Y, $result.MaxSize.X, $result.MaxSize.Y)
    if (($actual -join ',') -ne ($expected -join ',')) { throw "Unexpected work area: $actual" }
    if ($result.MinTrackSize.X -gt $result.MaxSize.X -or $result.MinTrackSize.Y -gt $result.MaxSize.Y) { throw 'Minimum window size exceeds work area' }
}
Check-Bounds @(0,0,1920,1080) @(0,0,1920,1032) @(0,0,1920,1032)
Check-Bounds @(0,0,1366,768) @(0,48,1366,768) @(0,48,1366,720)
Check-Bounds @(-1920,0,0,1080) @(-1872,0,0,1080) @(48,0,1872,1080)
Check-Bounds @(1920,-2160,5760,0) @(1920,-2160,5760,-96) @(0,0,3840,2064)
Write-Output 'PASS native C# compilation and work-area bounds: bottom/top/left taskbar, secondary monitor, high resolution'
