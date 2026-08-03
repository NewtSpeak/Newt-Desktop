# Newt-Desktop Android 环境（在当前 PowerShell 会话生效）
# 用法：. .\scripts\android-env.ps1
#
# 重要：Android NDK 的 ld.lld 无法处理路径中的中文（如 D:\研发\...）。
# 本脚本强制 CARGO_TARGET_DIR 到纯 ASCII 目录，与 src-tauri/.cargo/config.toml 一致。

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$ndkDir = Join-Path $sdk "ndk"
$ndk = $null
if (Test-Path $ndkDir) {
  $ndk = Get-ChildItem $ndkDir -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
$jdk = $env:JAVA_HOME
if (-not $jdk -or -not (Test-Path $jdk)) {
  $hit = Get-ChildItem "C:\Program Files\Microsoft" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "jdk-17*" } |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if ($hit) { $jdk = $hit.FullName }
}

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
if ($ndk) { $env:NDK_HOME = $ndk }
if ($jdk) { $env:JAVA_HOME = $jdk }

# 纯 ASCII 产物目录（避开 研发 等非 ASCII 路径导致的 NDK 链接失败）
$asciiTarget = "D:\tauri-target\newt-desktop"
New-Item -ItemType Directory -Force -Path $asciiTarget | Out-Null
$env:CARGO_TARGET_DIR = $asciiTarget

$prepend = @(
  (Join-Path $sdk "platform-tools"),
  (Join-Path $sdk "cmdline-tools\latest\bin")
)
if ($jdk) { $prepend = @((Join-Path $jdk "bin")) + $prepend }
if ($ndk) {
  $prebuilt = Join-Path $ndk "toolchains\llvm\prebuilt\windows-x86_64\bin"
  if (Test-Path $prebuilt) { $prepend += $prebuilt }
}
$env:Path = ($prepend -join ";") + ";" + $env:Path

# 若当前工作区路径含非 ASCII：提示使用联接（Gradle 虽可 overridePathCheck，仍建议 ASCII 路径）
$cwd = (Get-Location).Path
if ($cwd -match "[^\x00-\x7F]") {
  Write-Host "WARN: 当前路径含非 ASCII 字符: $cwd"
  Write-Host "      已设置 CARGO_TARGET_DIR=$asciiTarget"
  Write-Host "      gradle.properties 已含 android.overridePathCheck=true"
  if (Test-Path "D:\OwlSpeak\Newt-Desktop") {
    Write-Host "      推荐: cd D:\OwlSpeak\Newt-Desktop  再 bun run dev:android"
  } else {
    Write-Host "      创建联接后更稳: cmd /c mklink /J D:\OwlSpeak `"$($cwd -replace '\\Newt-Desktop$','')`""
    Write-Host "      然后 cd D:\OwlSpeak\Newt-Desktop"
  }
}

# 确保 gen/android/gradle.properties 含 overridePathCheck（android init 后可能被覆盖）
$gp = Join-Path $PSScriptRoot "..\src-tauri\gen\android\gradle.properties"
if (Test-Path $gp) {
  $text = Get-Content $gp -Raw -ErrorAction SilentlyContinue
  if ($text -and ($text -notmatch "android\.overridePathCheck")) {
    Add-Content -Path $gp -Value "`nandroid.overridePathCheck=true`n"
    Write-Host "已写入 android.overridePathCheck=true → $gp"
  }
}

Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "NDK_HOME=$env:NDK_HOME"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"
try { java -version 2>&1 | Select-Object -First 1 } catch {}
try { adb version 2>&1 | Select-Object -First 1 } catch {}
if ($ndk -and (Test-Path (Join-Path $ndk "source.properties"))) {
  Write-Host "NDK OK: $ndk"
} else {
  Write-Host "WARN: NDK not found under $sdk\ndk"
}

# 真机开发：端口反向 + 提示正确启动方式
try {
  adb reverse tcp:1420 tcp:1420 2>$null | Out-Null
  adb reverse tcp:8080 tcp:8080 2>$null | Out-Null
  Write-Host "adb reverse 1420/8080 OK"
} catch {
  Write-Host "WARN: adb reverse 跳过（未连设备？）"
}
Write-Host "Android 开发请用: bun run dev:android"
Write-Host "  若白屏且 log 出现 198.18.x:  bun run dev:android -- --host 192.168.x.x"
