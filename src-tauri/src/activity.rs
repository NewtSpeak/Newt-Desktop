//! 活动检测原生能力：
//! - 前台焦点应用（实时「正在玩」主信号）
//! - 进程列表 / Now Playing
//! - 应用图标提取（base64 PNG）供上传为封面

use serde::Serialize;
use std::collections::BTreeSet;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct RunningApp {
  pub name: String,
  pub display_name: String,
}

/// 前台应用（焦点窗口所属进程）。
#[derive(Debug, Clone, Serialize)]
pub struct ForegroundApp {
  /// 小写可执行名 / 进程名
  pub name: String,
  /// 展示名（窗口标题或应用名）
  pub display_name: String,
  /// 可执行文件或 .app 绝对路径（图标提取用）
  pub path: String,
  /// 窗口标题（若有）
  pub window_title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NowPlaying {
  pub title: String,
  pub artist: String,
  pub album: String,
  pub app: String,
  pub playing: bool,
}

#[tauri::command]
pub fn list_running_apps() -> Result<Vec<RunningApp>, String> {
  let names = list_process_names()?;
  let mut seen = BTreeSet::<String>::new();
  let mut out = Vec::new();
  for raw in names {
    let base = basename(&raw);
    if base.len() < 2 {
      continue;
    }
    let key = base.to_lowercase();
    if !seen.insert(key.clone()) {
      continue;
    }
    out.push(RunningApp {
      name: key,
      display_name: base.to_string(),
    });
  }
  out.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(out)
}

#[tauri::command]
pub fn get_foreground_app() -> Result<Option<ForegroundApp>, String> {
  Ok(foreground_app())
}

#[tauri::command]
pub fn get_now_playing() -> Result<Option<NowPlaying>, String> {
  Ok(now_playing())
}

/// 从可执行文件 / .app 提取 PNG 图标，返回 base64（无 data: 前缀）。
#[tauri::command]
pub fn extract_app_icon(path: String) -> Result<Option<String>, String> {
  let path = path.trim();
  if path.is_empty() {
    return Ok(None);
  }
  Ok(extract_icon_b64(path))
}

fn basename(raw: &str) -> &str {
  raw
    .rsplit(['/', '\\'])
    .next()
    .unwrap_or(raw)
    .trim()
}

fn list_process_names() -> Result<Vec<String>, String> {
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  {
    let output = Command::new("ps")
      .args(["-axo", "comm="])
      .output()
      .map_err(|e| format!("ps 失败: {e}"))?;
    if !output.status.success() {
      return Err("ps 退出非零".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    return Ok(
      text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect(),
    );
  }
  #[cfg(target_os = "windows")]
  {
    let output = Command::new("tasklist")
      .args(["/FO", "CSV", "/NH"])
      .output()
      .map_err(|e| format!("tasklist 失败: {e}"))?;
    if !output.status.success() {
      return Err("tasklist 退出非零".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut names = Vec::new();
    for line in text.lines() {
      let line = line.trim();
      if line.is_empty() {
        continue;
      }
      if let Some(rest) = line.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
          names.push(rest[..end].to_string());
        }
      }
    }
    return Ok(names);
  }
  #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
  {
    Ok(vec![])
  }
}

fn now_playing() -> Option<NowPlaying> {
  #[cfg(target_os = "macos")]
  {
    return macos_now_playing();
  }
  #[cfg(target_os = "windows")]
  {
    return windows_now_playing();
  }
  #[cfg(target_os = "linux")]
  {
    return linux_now_playing();
  }
  #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
  {
    None
  }
}

fn foreground_app() -> Option<ForegroundApp> {
  #[cfg(target_os = "macos")]
  {
    return macos_foreground();
  }
  #[cfg(target_os = "windows")]
  {
    return windows_foreground();
  }
  #[cfg(target_os = "linux")]
  {
    return linux_foreground();
  }
  #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
  {
    None
  }
}

fn extract_icon_b64(path: &str) -> Option<String> {
  #[cfg(target_os = "macos")]
  {
    return macos_extract_icon(path);
  }
  #[cfg(target_os = "windows")]
  {
    return windows_extract_icon(path);
  }
  #[cfg(target_os = "linux")]
  {
    return linux_extract_icon(path);
  }
  #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
  {
    let _ = path;
    None
  }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn macos_now_playing() -> Option<NowPlaying> {
  if let Some(np) = osascript_music("Music") {
    if np.playing || !np.title.is_empty() {
      return Some(np);
    }
  }
  if let Some(np) = osascript_music("Spotify") {
    if np.playing || !np.title.is_empty() {
      return Some(np);
    }
  }
  None
}

#[cfg(target_os = "macos")]
fn osascript_music(app: &str) -> Option<NowPlaying> {
  let script = match app {
    "Music" => r#"
      try
        tell application "Music"
          if player state is stopped then return "false" & (ASCII character 31) & "" & (ASCII character 31) & "" & (ASCII character 31) & ""
          set p to (player state is playing)
          set t to name of current track
          set a to artist of current track
          set al to album of current track
          return (p as string) & (ASCII character 31) & t & (ASCII character 31) & a & (ASCII character 31) & al
        end tell
      on error
        return ""
      end try
    "#,
    "Spotify" => r#"
      try
        tell application "Spotify"
          if player state is stopped then return "false" & (ASCII character 31) & "" & (ASCII character 31) & "" & (ASCII character 31) & ""
          set p to (player state is playing)
          set t to name of current track
          set a to artist of current track
          set al to album of current track
          return (p as string) & (ASCII character 31) & t & (ASCII character 31) & a & (ASCII character 31) & al
        end tell
      on error
        return ""
      end try
    "#,
    _ => return None,
  };
  let text = run_capture("osascript", &["-e", script])?;
  parse_usv_now_playing(&text, app)
}

#[cfg(target_os = "macos")]
fn macos_foreground() -> Option<ForegroundApp> {
  // 字段：path \x1f process_name \x1f window_title
  let script = r#"
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set procName to name of frontApp
      set winTitle to ""
      try
        if (count of windows of frontApp) > 0 then
          set winTitle to name of window 1 of frontApp
        end if
      end try
      set appPath to ""
      try
        set appPath to POSIX path of (file of frontApp as alias)
      on error
        try
          set appPath to POSIX path of (path to frontmost application as text)
        end try
      end try
      return appPath & (ASCII character 31) & procName & (ASCII character 31) & winTitle
    end tell
  "#;
  let text = run_capture("osascript", &["-e", script])?;
  let parts: Vec<&str> = text.split('\u{001f}').collect();
  let path = parts.first().map(|s| s.trim()).unwrap_or("");
  let proc = parts.get(1).map(|s| s.trim()).unwrap_or("");
  let title = parts.get(2).map(|s| s.trim()).unwrap_or("");
  if proc.is_empty() && path.is_empty() {
    return None;
  }
  let base = if !path.is_empty() {
    basename(path)
  } else {
    proc
  };
  // 过滤 Owl 自身
  let low = proc.to_lowercase();
  if low.contains("newt-desktop") || low == "owl desktop" {
    return None;
  }
  let display = if !title.is_empty() && title.len() < 80 {
    // 窗口标题有时比进程名更像游戏名，但可能是文档名；优先 bundle 名
    if path.contains(".app") {
      path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(proc)
        .trim_end_matches(".app")
        .to_string()
    } else {
      proc.to_string()
    }
  } else if path.contains(".app") {
    path
      .trim_end_matches('/')
      .rsplit('/')
      .next()
      .unwrap_or(proc)
      .trim_end_matches(".app")
      .to_string()
  } else {
    proc.to_string()
  };
  Some(ForegroundApp {
    name: base.to_lowercase().replace(".app", ""),
    display_name: display,
    path: path.to_string(),
    window_title: title.to_string(),
  })
}

#[cfg(target_os = "macos")]
fn macos_extract_icon(path: &str) -> Option<String> {
  let mut icon_path = path.to_string();
  // 若是 .app，找 icns
  if path.ends_with(".app") || path.contains(".app/") {
    let app_root = if let Some(idx) = path.find(".app") {
      format!("{}app", &path[..=idx + 3])
    } else {
      path.to_string()
    };
    // 常见 Resources/*.icns
    let resources = format!("{app_root}/Contents/Resources");
    if let Ok(rd) = std::fs::read_dir(&resources) {
      for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|e| e.to_str()) == Some("icns") {
          icon_path = p.to_string_lossy().to_string();
          break;
        }
      }
    }
  }
  let tmp = format!(
    "/tmp/owl-icon-{}-{}.png",
    std::process::id(),
    now_ms_simple()
  );
  let status = Command::new("sips")
    .args(["-s", "format", "png", &icon_path, "--out", &tmp])
    .status()
    .ok()?;
  if !status.success() {
    let _ = std::fs::remove_file(&tmp);
    return None;
  }
  let bytes = std::fs::read(&tmp).ok()?;
  let _ = std::fs::remove_file(&tmp);
  if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
    return None;
  }
  Some(b64_encode(&bytes))
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn windows_now_playing() -> Option<NowPlaying> {
  let ps = r#"
$ErrorActionPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(3000) | Out-Null
    if (-not $netTask.IsCompleted) { return $null }
    return $netTask.Result
  }
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  if ($null -eq $mgr) { return }
  $session = $mgr.GetCurrentSession()
  if ($null -eq $session) { return }
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($null -eq $props) { return }
  $info = $session.GetPlaybackInfo()
  $playing = if ($info.PlaybackStatus -eq 4) { 'true' } else { 'false' }
  $title = [string]$props.Title
  $artist = [string]$props.Artist
  $album = [string]$props.AlbumTitle
  $app = [string]$session.SourceAppUserModelId
  if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($artist)) { return }
  $us = [char]0x1F
  Write-Output ($playing + $us + $title + $us + $artist + $us + $album + $us + $app)
} catch {}
"#;
  let text = run_capture(
    "powershell",
    &["-NoProfile", "-NonInteractive", "-Command", ps],
  )?;
  let parts: Vec<&str> = text.split('\u{001f}').collect();
  if parts.len() < 4 {
    return None;
  }
  let playing = parts[0].eq_ignore_ascii_case("true");
  let title = parts[1].trim().to_string();
  let artist = parts[2].trim().to_string();
  let album = parts[3].trim().to_string();
  let app = if parts.len() > 4 {
    simplify_aumid(parts[4].trim())
  } else {
    "Media".into()
  };
  if title.is_empty() && artist.is_empty() {
    return None;
  }
  Some(NowPlaying {
    title,
    artist,
    album,
    app,
    playing,
  })
}

#[cfg(target_os = "windows")]
fn simplify_aumid(aumid: &str) -> String {
  if aumid.is_empty() {
    return "Media".into();
  }
  let base = aumid.split('!').next().unwrap_or(aumid);
  let name = base.split('_').next().unwrap_or(base);
  let name = name.rsplit('.').next().unwrap_or(name);
  if name.is_empty() {
    "Media".into()
  } else {
    name.to_string()
  }
}

#[cfg(target_os = "windows")]
fn windows_foreground() -> Option<ForegroundApp> {
  // 输出：path \x1f processName \x1f windowTitle
  let ps = r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$hwnd = [FgWin]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { return }
$procId = 0
[void][FgWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
if ($procId -eq 0) { return }
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($null -eq $p) { return }
$path = ''
try { $path = $p.Path } catch {}
$name = $p.ProcessName
$sb = New-Object System.Text.StringBuilder 512
[void][FgWin]::GetWindowText($hwnd, $sb, $sb.Capacity)
$title = $sb.ToString()
if (-not $path) { $path = $name + '.exe' }
$us = [char]0x1F
Write-Output ($path + $us + $name + $us + $title)
"#;
  let text = run_capture(
    "powershell",
    &["-NoProfile", "-NonInteractive", "-Command", ps],
  )?;
  let parts: Vec<&str> = text.split('\u{001f}').collect();
  if parts.is_empty() {
    return None;
  }
  let path = parts[0].trim();
  let proc = parts.get(1).map(|s| s.trim()).unwrap_or("");
  let title = parts.get(2).map(|s| s.trim()).unwrap_or("");
  if path.is_empty() && proc.is_empty() {
    return None;
  }
  let file = basename(path);
  let low = file.to_lowercase();
  if low.contains("newt-desktop") || low == "explorer.exe" {
    return None;
  }
  let display = if !proc.is_empty() {
    proc.to_string()
  } else {
    file.trim_end_matches(".exe").to_string()
  };
  Some(ForegroundApp {
    name: file.to_lowercase(),
    display_name: display,
    path: path.to_string(),
    window_title: title.to_string(),
  })
}

#[cfg(target_os = "windows")]
fn windows_extract_icon(path: &str) -> Option<String> {
  let path_escaped = path.replace('\'', "''");
  let ps = format!(
    r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('{path_escaped}')
if ($null -eq $icon) {{ return }}
$bmp = $icon.ToBitmap()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
"#
  );
  let text = run_capture(
    "powershell",
    &["-NoProfile", "-NonInteractive", "-Command", &ps],
  )?;
  let b64 = text.trim();
  if b64.is_empty() || b64.len() > 3 * 1024 * 1024 {
    return None;
  }
  Some(b64.to_string())
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn linux_now_playing() -> Option<NowPlaying> {
  let text = run_capture(
    "playerctl",
    &[
      "metadata",
      "--format",
      "{{status}}\x1f{{title}}\x1f{{artist}}\x1f{{album}}\x1f{{playerName}}",
    ],
  )?;
  let parts: Vec<&str> = text.split('\u{001f}').collect();
  if parts.len() < 4 {
    return None;
  }
  let playing = parts[0].trim().eq_ignore_ascii_case("playing");
  let title = parts[1].trim().to_string();
  let artist = parts[2].trim().to_string();
  let album = parts[3].trim().to_string();
  let app = if parts.len() > 4 && !parts[4].trim().is_empty() {
    parts[4].trim().to_string()
  } else {
    "Media".into()
  };
  if title.is_empty() && artist.is_empty() {
    return None;
  }
  Some(NowPlaying {
    title,
    artist,
    album,
    app,
    playing,
  })
}

#[cfg(target_os = "linux")]
fn linux_foreground() -> Option<ForegroundApp> {
  let pid = run_capture("xdotool", &["getactivewindow", "getwindowpid"])?;
  let pid = pid.trim();
  if pid.is_empty() {
    return None;
  }
  let title = run_capture("xdotool", &["getactivewindow", "getwindowname"]).unwrap_or_default();
  let comm = std::fs::read_to_string(format!("/proc/{pid}/comm"))
    .ok()?
    .trim()
    .to_string();
  if comm.is_empty() {
    return None;
  }
  let exe = std::fs::read_link(format!("/proc/{pid}/exe"))
    .ok()
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default();
  Some(ForegroundApp {
    name: comm.to_lowercase(),
    display_name: comm,
    path: exe,
    window_title: title.trim().to_string(),
  })
}

#[cfg(target_os = "linux")]
fn linux_extract_icon(_path: &str) -> Option<String> {
  // 桌面图标路径因 DE 而异，首期返回 None；依赖目录封面 / 用户登记
  None
}

// ---------------------------------------------------------------------------
// helpers（仅桌面平台实现调用；移动端不编译，避免 dead_code）
// ---------------------------------------------------------------------------

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn run_capture(cmd: &str, args: &[&str]) -> Option<String> {
  let output = Command::new(cmd).args(args).output().ok()?;
  if !output.status.success() && output.stdout.is_empty() {
    return None;
  }
  let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if text.is_empty() {
    return None;
  }
  Some(text)
}

// 仅 macOS Now Playing（osascript）解析用
#[cfg(target_os = "macos")]
fn parse_usv_now_playing(text: &str, app: &str) -> Option<NowPlaying> {
  let parts: Vec<&str> = text.split('\u{001f}').collect();
  if parts.len() < 4 {
    return None;
  }
  let playing = parts[0].eq_ignore_ascii_case("true");
  let title = parts[1].trim().to_string();
  let artist = parts[2].trim().to_string();
  let album = parts[3].trim().to_string();
  if title.is_empty() && artist.is_empty() {
    return None;
  }
  Some(NowPlaying {
    title,
    artist,
    album,
    app: app.to_string(),
    playing,
  })
}

#[cfg(target_os = "macos")]
fn now_ms_simple() -> u128 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn b64_encode(bytes: &[u8]) -> String {
  const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
  for chunk in bytes.chunks(3) {
    let b0 = chunk[0] as u32;
    let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
    let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
    let n = (b0 << 16) | (b1 << 8) | b2;
    out.push(T[((n >> 18) & 63) as usize] as char);
    out.push(T[((n >> 12) & 63) as usize] as char);
    if chunk.len() > 1 {
      out.push(T[((n >> 6) & 63) as usize] as char);
    } else {
      out.push('=');
    }
    if chunk.len() > 2 {
      out.push(T[(n & 63) as usize] as char);
    } else {
      out.push('=');
    }
  }
  out
}
