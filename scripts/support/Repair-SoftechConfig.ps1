param([string]$ServerDirectory = 'C:\SoftechServer')
$ErrorActionPreference = 'Stop'
$temporary = $null
try {
    $directory = (Resolve-Path -LiteralPath $ServerDirectory).Path
    $config = Join-Path $directory 'config.json'
    $runtime = Join-Path $directory 'runtime/node.exe'
    if (!(Test-Path -LiteralPath $config -PathType Leaf)) { throw 'config.json topilmadi. Hech narsa yaratilmadi.' }
    if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) { throw 'runtime/node.exe topilmadi. Hech narsa almashtirilmadi.' }
    $original = [IO.File]::ReadAllBytes($config)
    $offset = 0
    $decoder = New-Object System.Text.UTF8Encoding($false, $true)
    if ($original.Length -ge 3 -and $original[0] -eq 239 -and $original[1] -eq 187 -and $original[2] -eq 191) { $offset = 3 }
    elseif ($original.Length -ge 2 -and $original[0] -eq 255 -and $original[1] -eq 254) {
        $offset = 2; $decoder = New-Object System.Text.UnicodeEncoding($false, $false, $true)
    }
    elseif ($original.Length -ge 2 -and $original[0] -eq 254 -and $original[1] -eq 255) {
        $offset = 2; $decoder = New-Object System.Text.UnicodeEncoding($true, $false, $true)
    }
    $text = $decoder.GetString($original, $offset, $original.Length - $offset)
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $normalized = $utf8.GetBytes($text)
    $temporary = Join-Path $directory ('config-repair-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllBytes($temporary, $normalized)
    # Validate with the installed Node parser; never print config/credential values.
    & $runtime -e "try{const x=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!x||typeof x!=='object'||Array.isArray(x))process.exit(2)}catch{process.exit(2)}" $temporary
    if ($LASTEXITCODE -ne 0) { throw 'JSON tarkibi buzilgan. Asl config.json saqlandi; uni mutaxassis tekshirishi kerak.' }
    if ([Convert]::ToBase64String($original) -eq [Convert]::ToBase64String($normalized)) {
        Write-Output 'Config formati toza. Fayl almashtirilmadi.'
    } else {
        # Refuse to overwrite a concurrent change from a running server.
        if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($config)) -ne [Convert]::ToBase64String($original)) {
            throw 'Sozlamalar boshqa jarayon tomonidan yangilandi. Softech oynasini yopib qayta urining.'
        }
        $backup = $config + '.before-encoding-repair-' + [guid]::NewGuid().ToString('N') + '.bak'
        [IO.File]::Replace($temporary, $config, $backup)
        $temporary = $null
        Write-Output 'TUZATILDI: config.json UTF-8 formatiga keltirildi. Barcha sozlamalar saqlandi.'
        Write-Output ('Asl fayl zaxirasi: ' + $backup)
    }
    Write-Output 'Endi Softech Server dasturini oching yoki Qayta urinish tugmasini bosing.'
    exit 0
} catch {
    Write-Output ('TUZATILMADI: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
