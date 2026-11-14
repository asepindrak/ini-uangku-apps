# Release Helper Script for Ini Uangku
param (
    [Parameter(Mandatory=$false)]
    [string]$NewVersion = ""
)

Write-Host "🎀 Ini Uangku Release Automation" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($NewVersion)) {
    $currentPkg = Get-Content "package.json" | ConvertFrom-Json
    $curVer = $currentPkg.version
    Write-Host "Versi saat ini: v$curVer"
    $NewVersion = Read-Host "Masukkan versi baru (contoh: 1.0.1)"
}

if ([string]::IsNullOrWhiteSpace($NewVersion)) {
    Write-Error "Versi tidak boleh kosong."
    exit 1
}

$cleanVer = $NewVersion.TrimStart('v').TrimStart('V')
Write-Host "🚀 Menyiapkan rilis versi: v$cleanVer" -ForegroundColor Green

# 1. Update package.json
$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$pkg.version = $cleanVer
$pkg | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding UTF8
Write-Host "✔ package.json diperbarui ke $cleanVer"

# 2. Update src-tauri/tauri.conf.json
$tauriConf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$tauriConf.version = $cleanVer
$tauriConf | ConvertTo-Json -Depth 10 | Set-Content "src-tauri/tauri.conf.json" -Encoding UTF8
Write-Host "✔ tauri.conf.json diperbarui ke $cleanVer"

# 3. Update src-tauri/Cargo.toml
$cargoContent = Get-Content "src-tauri/Cargo.toml" -Raw
$cargoContent = $cargoContent -replace 'version = "[0-9]+\.[0-9]+\.[0-9]+"', "version = `"$cleanVer`""
$cargoContent | Set-Content "src-tauri/Cargo.toml" -Encoding UTF8
Write-Host "✔ Cargo.toml diperbarui ke $cleanVer"

# 4. Git commit & tag
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore(release): bump version to v$cleanVer"
git tag "v$cleanVer"

Write-Host "🎉 Versi v$cleanVer siap! Jalankan perintah berikut untuk merilis ke GitHub Actions:" -ForegroundColor Yellow
Write-Host "git push origin main --tags" -ForegroundColor White
