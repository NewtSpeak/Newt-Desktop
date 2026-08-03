// 桌面端应用内更新：
// - 版本源：GitHub Releases（NewtSpeak/Newt-Desktop）
// - 下载：内置多个中国大陆加速镜像，失败后回退官方 GitHub
// - 策略：每 10 分钟自动检测；有新版本则后台下载到本地，不立刻安装；
//         用户点击「立即更新」或关闭应用时才启动安装程序并退出。
//
// 移动端（Android/iOS）不提供此能力，命令返回不支持。

#![cfg(desktop)]

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const GITHUB_OWNER: &str = "NewtSpeak";
const GITHUB_REPO: &str = "Newt-Desktop";
const CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);
const USER_AGENT: &str = "NewtSpeak-Desktop-Updater/0.1";

/// 中国大陆常用 GitHub Release 加速前缀（顺序即尝试顺序）。
/// 多数以「前缀 + 完整 https://github.com/...」形式拼接。
const DOWNLOAD_MIRRORS: &[Mirror] = &[
  Mirror {
    id: "ghfast",
    label: "Ghfast",
    kind: MirrorKind::Prefix("https://ghfast.top/"),
  },
  Mirror {
    id: "ghproxy-net",
    label: "Ghproxy.net",
    kind: MirrorKind::Prefix("https://ghproxy.net/"),
  },
  Mirror {
    id: "mirror-ghproxy",
    label: "Mirror.ghproxy",
    kind: MirrorKind::Prefix("https://mirror.ghproxy.com/"),
  },
  Mirror {
    id: "gh-proxy",
    label: "Gh-proxy.com",
    kind: MirrorKind::Prefix("https://gh-proxy.com/"),
  },
  Mirror {
    id: "gitdl",
    label: "Gitdl.cn",
    kind: MirrorKind::Prefix("https://gitdl.cn/"),
  },
  Mirror {
    id: "moeyy",
    label: "Moeyy",
    kind: MirrorKind::Prefix("https://github.moeyy.xyz/"),
  },
  Mirror {
    id: "kkgithub",
    label: "KKGitHub",
    kind: MirrorKind::ReplaceHost {
      from: "https://github.com/",
      to: "https://kkgithub.com/",
    },
  },
  // 官方源放最后，网络通畅时仍可直连
  Mirror {
    id: "github",
    label: "GitHub 官方",
    kind: MirrorKind::Direct,
  },
];

/// API 探测顺序（部分镜像可代理 api.github.com）
const API_ENDPOINTS: &[&str] = &[
  "https://ghfast.top/https://api.github.com/repos/NewtSpeak/Newt-Desktop/releases/latest",
  "https://ghproxy.net/https://api.github.com/repos/NewtSpeak/Newt-Desktop/releases/latest",
  "https://mirror.ghproxy.com/https://api.github.com/repos/NewtSpeak/Newt-Desktop/releases/latest",
  "https://api.kkgithub.com/repos/NewtSpeak/Newt-Desktop/releases/latest",
  "https://api.github.com/repos/NewtSpeak/Newt-Desktop/releases/latest",
];

struct Mirror {
  id: &'static str,
  label: &'static str,
  kind: MirrorKind,
}

enum MirrorKind {
  Prefix(&'static str),
  ReplaceHost {
    from: &'static str,
    to: &'static str,
  },
  Direct,
}

impl Mirror {
  fn rewrite(&self, original: &str) -> String {
    match self.kind {
      MirrorKind::Prefix(p) => format!("{p}{original}"),
      MirrorKind::ReplaceHost { from, to } => {
        if let Some(rest) = original.strip_prefix(from) {
          format!("{to}{rest}")
        } else {
          original.to_string()
        }
      }
      MirrorKind::Direct => original.to_string(),
    }
  }
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
  Idle,
  Checking,
  UpToDate,
  Available,
  Downloading,
  Ready,
  Installing,
  Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
  pub phase: UpdatePhase,
  pub current_version: String,
  pub latest_version: Option<String>,
  pub release_notes: Option<String>,
  pub asset_name: Option<String>,
  pub download_url: Option<String>,
  pub mirror_id: Option<String>,
  pub mirror_label: Option<String>,
  pub bytes_downloaded: u64,
  pub bytes_total: Option<u64>,
  pub progress: f64,
  pub local_path: Option<String>,
  pub error: Option<String>,
  pub last_checked_at: Option<String>,
  pub auto_check: bool,
}

impl UpdateStatus {
  fn fresh(current: &str, auto_check: bool) -> Self {
    Self {
      phase: UpdatePhase::Idle,
      current_version: current.to_string(),
      latest_version: None,
      release_notes: None,
      asset_name: None,
      download_url: None,
      mirror_id: None,
      mirror_label: None,
      bytes_downloaded: 0,
      bytes_total: None,
      progress: 0.0,
      local_path: None,
      error: None,
      last_checked_at: None,
      auto_check,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedReady {
  version: String,
  path: String,
  asset_name: String,
  download_url: String,
}

pub struct UpdaterState {
  inner: Mutex<UpdateStatus>,
  /// 防止并发 check/download
  busy: AtomicBool,
  install_on_quit: AtomicBool,
}

impl UpdaterState {
  pub fn new() -> Self {
    Self {
      inner: Mutex::new(UpdateStatus::fresh(env!("CARGO_PKG_VERSION"), true)),
      busy: AtomicBool::new(false),
      install_on_quit: AtomicBool::new(true),
    }
  }

  fn snapshot(&self) -> UpdateStatus {
    self.inner.lock().expect("updater lock").clone()
  }

  fn with_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut UpdateStatus) -> R,
  {
    let mut guard = self.inner.lock().expect("updater lock");
    f(&mut guard)
  }
}

// ---------------------------------------------------------------------------
// GitHub JSON
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GhRelease {
  tag_name: String,
  body: Option<String>,
  assets: Vec<GhAsset>,
  draft: Option<bool>,
  prerelease: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
  name: String,
  size: u64,
  browser_download_url: String,
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .timeout(Duration::from_secs(60))
    .connect_timeout(Duration::from_secs(15))
    .redirect(reqwest::redirect::Policy::limited(10))
    .build()
    .map_err(|e| e.to_string())
}

fn now_iso() -> String {
  // 不引入 chrono：用简单 UTC 近似（仅展示用）
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  format!("{secs}")
}

fn normalize_version(raw: &str) -> String {
  raw.trim().trim_start_matches('v').trim_start_matches('V').to_string()
}

fn is_newer(latest: &str, current: &str) -> bool {
  match (
    semver::Version::parse(&normalize_version(latest)),
    semver::Version::parse(&normalize_version(current)),
  ) {
    (Ok(l), Ok(c)) => l > c,
    _ => normalize_version(latest) != normalize_version(current)
      && !normalize_version(latest).is_empty(),
  }
}

fn asset_score(name: &str) -> i32 {
  let n = name.to_ascii_lowercase();
  // 跳过 web 包与校验文件
  if n.contains("web") || n.ends_with(".sha256") || n.starts_with("sha256sums") {
    return -1;
  }
  #[cfg(target_os = "windows")]
  {
    if (n.contains("windows") || n.contains("win")) && n.ends_with("setup.exe") {
      return 100;
    }
    if n.ends_with(".msi") && (n.contains("windows") || n.contains("win") || n.contains("x64")) {
      return 90;
    }
    if n.ends_with(".exe") && (n.contains("windows") || n.contains("win")) {
      return 80;
    }
    if n.ends_with("setup.exe") {
      return 70;
    }
    if n.ends_with(".msi") {
      return 60;
    }
  }
  #[cfg(target_os = "macos")]
  {
    if n.ends_with(".dmg") && (n.contains("macos") || n.contains("darwin") || n.contains("universal"))
    {
      return 100;
    }
    if n.ends_with(".dmg") {
      return 90;
    }
    if n.contains("app.tar.gz") || n.ends_with(".app.tar.gz") {
      return 70;
    }
  }
  #[cfg(target_os = "linux")]
  {
    if n.ends_with(".appimage") {
      return 100;
    }
    if n.ends_with(".deb") && n.contains("amd64") {
      return 90;
    }
    if n.ends_with(".deb") {
      return 80;
    }
    if n.ends_with(".rpm") {
      return 70;
    }
  }
  -1
}

fn pick_asset(assets: &[GhAsset]) -> Option<&GhAsset> {
  assets
    .iter()
    .filter(|a| asset_score(&a.name) >= 0)
    .max_by_key(|a| asset_score(&a.name))
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join("updates");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn ready_meta_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(updates_dir(app)?.join("ready.json"))
}

fn emit_status(app: &AppHandle, state: &UpdaterState) {
  let status = state.snapshot();
  let _ = app.emit("updater://status", status);
}

fn persist_ready(app: &AppHandle, ready: &PersistedReady) -> Result<(), String> {
  let path = ready_meta_path(app)?;
  let data = serde_json::to_string_pretty(ready).map_err(|e| e.to_string())?;
  fs::write(path, data).map_err(|e| e.to_string())
}

fn load_persisted_ready(app: &AppHandle) -> Option<PersistedReady> {
  let path = ready_meta_path(app).ok()?;
  let data = fs::read_to_string(path).ok()?;
  let ready: PersistedReady = serde_json::from_str(&data).ok()?;
  if Path::new(&ready.path).is_file() && is_newer(&ready.version, env!("CARGO_PKG_VERSION")) {
    Some(ready)
  } else {
    let _ = fs::remove_file(ready_meta_path(app).ok()?);
    None
  }
}

fn clear_persisted_ready(app: &AppHandle) {
  if let Ok(path) = ready_meta_path(app) {
    let _ = fs::remove_file(path);
  }
}

// ---------------------------------------------------------------------------
// 公共：启动后台轮询 + 恢复已下载包
// ---------------------------------------------------------------------------

pub fn bootstrap(app: &AppHandle) {
  let state = app.state::<UpdaterState>();
  // 恢复上次已下载但未安装的包
  if let Some(ready) = load_persisted_ready(app) {
    state.with_mut(|s| {
      s.phase = UpdatePhase::Ready;
      s.latest_version = Some(ready.version.clone());
      s.asset_name = Some(ready.asset_name.clone());
      s.download_url = Some(ready.download_url.clone());
      s.local_path = Some(ready.path.clone());
      s.progress = 1.0;
      s.error = None;
    });
    emit_status(app, &state);
  }

  let app_check = app.clone();
  tauri::async_runtime::spawn(async move {
    // 启动后稍等再首次检测，避免抢启动带宽
    tokio::time::sleep(Duration::from_secs(15)).await;
    loop {
      {
        let st = app_check.state::<UpdaterState>();
        let auto = st.with_mut(|s| s.auto_check);
        if auto {
          let _ = run_check_and_maybe_download(app_check.clone()).await;
        }
      }
      tokio::time::sleep(CHECK_INTERVAL).await;
    }
  });
}

async fn run_check_and_maybe_download(app: AppHandle) -> Result<(), String> {
  let state = app.state::<UpdaterState>();
  if state.busy.swap(true, Ordering::SeqCst) {
    return Ok(());
  }
  let result = async {
    check_for_update(&app, &state).await?;
    let should_download = state.with_mut(|s| s.phase == UpdatePhase::Available);
    if should_download {
      download_update(&app, &state).await?;
    }
    Ok::<(), String>(())
  }
  .await;
  state.busy.store(false, Ordering::SeqCst);
  if let Err(err) = result {
    state.with_mut(|s| {
      // 保留 Ready，不因检测失败覆盖已下载包
      if s.phase != UpdatePhase::Ready {
        s.phase = UpdatePhase::Error;
        s.error = Some(err);
      }
    });
    emit_status(&app, &state);
  }
  Ok(())
}

async fn check_for_update(app: &AppHandle, state: &UpdaterState) -> Result<(), String> {
  // 已有 Ready 且版本仍新，跳过
  if state.with_mut(|s| s.phase == UpdatePhase::Ready) {
    if let Some(ready) = load_persisted_ready(app) {
      state.with_mut(|s| {
        s.phase = UpdatePhase::Ready;
        s.latest_version = Some(ready.version);
        s.local_path = Some(ready.path);
        s.asset_name = Some(ready.asset_name);
        s.download_url = Some(ready.download_url);
        s.progress = 1.0;
        s.last_checked_at = Some(now_iso());
      });
      emit_status(app, state);
      return Ok(());
    }
  }

  state.with_mut(|s| {
    s.phase = UpdatePhase::Checking;
    s.error = None;
  });
  emit_status(app, state);

  let client = http_client()?;
  let mut last_err = String::from("无法连接更新服务器");
  let mut release: Option<GhRelease> = None;

  for url in API_ENDPOINTS {
    match client.get(*url).header("Accept", "application/vnd.github+json").send().await {
      Ok(resp) if resp.status().is_success() => match resp.json::<GhRelease>().await {
        Ok(r) => {
          release = Some(r);
          break;
        }
        Err(e) => last_err = format!("解析 GitHub 响应失败: {e}"),
      },
      Ok(resp) => last_err = format!("GitHub API HTTP {}", resp.status()),
      Err(e) => last_err = e.to_string(),
    }
  }

  let release = release.ok_or(last_err)?;
  // 跳过草稿 / 预发布（正式渠道只跟 latest 稳定版）
  if release.draft.unwrap_or(false) || release.prerelease.unwrap_or(false) {
    state.with_mut(|s| {
      s.phase = UpdatePhase::UpToDate;
      s.last_checked_at = Some(now_iso());
    });
    emit_status(app, state);
    return Ok(());
  }

  let current = env!("CARGO_PKG_VERSION");
  let latest = normalize_version(&release.tag_name);
  if !is_newer(&latest, current) {
    // 当前已最新：清理旧下载
    clear_persisted_ready(app);
    state.with_mut(|s| {
      s.phase = UpdatePhase::UpToDate;
      s.latest_version = Some(latest);
      s.release_notes = release.body;
      s.asset_name = None;
      s.download_url = None;
      s.local_path = None;
      s.progress = 0.0;
      s.bytes_downloaded = 0;
      s.bytes_total = None;
      s.error = None;
      s.last_checked_at = Some(now_iso());
    });
    emit_status(app, state);
    return Ok(());
  }

  let asset = pick_asset(&release.assets).ok_or_else(|| {
    format!(
      "最新版本 v{latest} 未找到适合本系统的安装包（平台: {}）",
      std::env::consts::OS
    )
  })?;

  state.with_mut(|s| {
    s.phase = UpdatePhase::Available;
    s.latest_version = Some(latest);
    s.release_notes = release.body;
    s.asset_name = Some(asset.name.clone());
    s.download_url = Some(asset.browser_download_url.clone());
    s.bytes_total = Some(asset.size);
    s.bytes_downloaded = 0;
    s.progress = 0.0;
    s.local_path = None;
    s.error = None;
    s.last_checked_at = Some(now_iso());
    s.mirror_id = None;
    s.mirror_label = None;
  });
  emit_status(app, state);
  let _ = (GITHUB_OWNER, GITHUB_REPO);
  Ok(())
}

async fn download_update(app: &AppHandle, state: &UpdaterState) -> Result<(), String> {
  let (version, asset_name, download_url, expected_size) = state.with_mut(|s| {
    (
      s.latest_version.clone().unwrap_or_default(),
      s.asset_name.clone().unwrap_or_default(),
      s.download_url.clone().unwrap_or_default(),
      s.bytes_total,
    )
  });
  if version.is_empty() || asset_name.is_empty() || download_url.is_empty() {
    return Err("没有可下载的更新".into());
  }

  // 若本地已有完整文件，直接 Ready
  let dir = updates_dir(app)?;
  let dest = dir.join(&asset_name);
  if dest.is_file() {
    if let Ok(meta) = dest.metadata() {
      if expected_size.map(|t| meta.len() == t).unwrap_or(meta.len() > 1024 * 1024) {
        let ready = PersistedReady {
          version: version.clone(),
          path: dest.to_string_lossy().to_string(),
          asset_name: asset_name.clone(),
          download_url: download_url.clone(),
        };
        persist_ready(app, &ready)?;
        state.with_mut(|s| {
          s.phase = UpdatePhase::Ready;
          s.local_path = Some(ready.path.clone());
          s.progress = 1.0;
          s.bytes_downloaded = meta.len();
        });
        emit_status(app, state);
        return Ok(());
      }
    }
  }

  state.with_mut(|s| {
    s.phase = UpdatePhase::Downloading;
    s.progress = 0.0;
    s.bytes_downloaded = 0;
    s.error = None;
  });
  emit_status(app, state);

  let client = http_client()?;
  let mut last_err = String::from("所有镜像下载失败");
  let partial = dir.join(format!("{asset_name}.partial"));

  for mirror in DOWNLOAD_MIRRORS {
    let url = mirror.rewrite(&download_url);
    state.with_mut(|s| {
      s.mirror_id = Some(mirror.id.to_string());
      s.mirror_label = Some(mirror.label.to_string());
      s.progress = 0.0;
      s.bytes_downloaded = 0;
    });
    emit_status(app, state);

    match try_download(&client, &url, &partial, app, state, expected_size).await {
      Ok(()) => {
        // 原子替换
        if dest.exists() {
          let _ = fs::remove_file(&dest);
        }
        fs::rename(&partial, &dest).map_err(|e| e.to_string())?;
        let ready = PersistedReady {
          version: version.clone(),
          path: dest.to_string_lossy().to_string(),
          asset_name: asset_name.clone(),
          download_url: download_url.clone(),
        };
        persist_ready(app, &ready)?;
        let size = dest.metadata().map(|m| m.len()).unwrap_or(0);
        state.with_mut(|s| {
          s.phase = UpdatePhase::Ready;
          s.local_path = Some(ready.path);
          s.progress = 1.0;
          s.bytes_downloaded = size;
          s.error = None;
        });
        emit_status(app, state);
        log::info!(
          "updater: 已下载 v{version} via {} → {}",
          mirror.label,
          dest.display()
        );
        return Ok(());
      }
      Err(e) => {
        log::warn!("updater: 镜像 {} 失败: {e}", mirror.label);
        last_err = format!("{}: {e}", mirror.label);
        let _ = fs::remove_file(&partial);
      }
    }
  }

  state.with_mut(|s| {
    s.phase = UpdatePhase::Error;
    s.error = Some(last_err.clone());
  });
  emit_status(app, state);
  Err(last_err)
}

async fn try_download(
  client: &reqwest::Client,
  url: &str,
  dest: &Path,
  app: &AppHandle,
  state: &UpdaterState,
  expected_size: Option<u64>,
) -> Result<(), String> {
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("HTTP {}", resp.status()));
  }
  let total = resp.content_length().or(expected_size);
  let mut file = File::create(dest).map_err(|e| e.to_string())?;
  let mut stream = resp.bytes_stream();
  let mut downloaded: u64 = 0;
  let mut last_emit = 0u64;

  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|e| e.to_string())?;
    file.write_all(&chunk).map_err(|e| e.to_string())?;
    downloaded += chunk.len() as u64;
    // 每 256KB 或完成时推送进度
    if downloaded - last_emit >= 256 * 1024 || total.map(|t| downloaded >= t).unwrap_or(false) {
      last_emit = downloaded;
      let progress = match total {
        Some(t) if t > 0 => (downloaded as f64 / t as f64).clamp(0.0, 1.0),
        _ => 0.0,
      };
      state.with_mut(|s| {
        s.bytes_downloaded = downloaded;
        s.bytes_total = total;
        s.progress = progress;
        s.phase = UpdatePhase::Downloading;
      });
      emit_status(app, state);
    }
  }
  file.flush().map_err(|e| e.to_string())?;
  if let Some(t) = expected_size {
    if downloaded < t / 2 {
      return Err(format!("下载不完整：{downloaded}/{t} 字节"));
    }
  }
  if downloaded < 1024 * 100 {
    return Err(format!("文件过小（{downloaded} 字节），可能不是安装包"));
  }
  Ok(())
}

fn install_package(path: &Path) -> Result<(), String> {
  if !path.is_file() {
    return Err("安装包不存在".into());
  }
  let path_str = path.to_string_lossy().to_string();

  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    let lower = path_str.to_ascii_lowercase();
    // 延迟 2 秒再启动安装，给本进程退出腾出文件锁
    let script = if lower.ends_with(".msi") {
      format!(
        "ping 127.0.0.1 -n 3 >nul & msiexec /i \"{path_str}\" /passive"
      )
    } else {
      // NSIS / setup.exe
      format!("ping 127.0.0.1 -n 3 >nul & start \"\" \"{path_str}\"")
    };
    Command::new("cmd")
      .args(["/C", &script])
      .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
      .spawn()
      .map_err(|e| format!("启动安装程序失败: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&path_str)
      .spawn()
      .map_err(|e| format!("打开安装包失败: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "linux")]
  {
    let lower = path_str.to_ascii_lowercase();
    if lower.ends_with(".appimage") {
      let _ = Command::new("chmod").args(["+x", &path_str]).status();
      Command::new(&path_str)
        .spawn()
        .map_err(|e| format!("启动 AppImage 失败: {e}"))?;
    } else if lower.ends_with(".deb") {
      // 尝试用系统包安装器；失败则 xdg-open
      if Command::new("pkexec")
        .args(["dpkg", "-i", &path_str])
        .spawn()
        .is_err()
      {
        let _ = Command::new("xdg-open").arg(&path_str).spawn();
      }
    } else {
      let _ = Command::new("xdg-open").arg(&path_str).spawn();
    }
    return Ok(());
  }

  #[allow(unreachable_code)]
  Err("当前平台暂不支持自动安装".into())
}

/// 关闭窗口时：若有已下载更新且开启「退出时安装」，则安装并退出。
pub fn handle_close_requested(app: &AppHandle, state: &UpdaterState) -> bool {
  // 返回 true = 拦截默认关闭并自行处理
  let (phase, path) = state.with_mut(|s| (s.phase.clone(), s.local_path.clone()));
  if phase != UpdatePhase::Ready {
    return false;
  }
  if !state.install_on_quit.load(Ordering::SeqCst) {
    return false;
  }
  let Some(path) = path else {
    return false;
  };
  state.with_mut(|s| s.phase = UpdatePhase::Installing);
  emit_status(app, state);
  if let Err(e) = install_package(Path::new(&path)) {
    log::error!("updater: 退出安装失败: {e}");
    state.with_mut(|s| {
      s.phase = UpdatePhase::Error;
      s.error = Some(e);
    });
    emit_status(app, state);
    return false;
  }
  clear_persisted_ready(app);
  app.exit(0);
  true
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn updater_get_status(state: State<'_, UpdaterState>) -> UpdateStatus {
  state.snapshot()
}

#[tauri::command]
pub async fn updater_check(app: AppHandle, state: State<'_, UpdaterState>) -> Result<UpdateStatus, String> {
  if state.busy.swap(true, Ordering::SeqCst) {
    return Ok(state.snapshot());
  }
  let result = check_for_update(&app, &state).await;
  state.busy.store(false, Ordering::SeqCst);
  result?;
  Ok(state.snapshot())
}

#[tauri::command]
pub async fn updater_download(
  app: AppHandle,
  state: State<'_, UpdaterState>,
) -> Result<UpdateStatus, String> {
  if state.busy.swap(true, Ordering::SeqCst) {
    return Err("已有更新任务进行中".into());
  }
  let result = download_update(&app, &state).await;
  state.busy.store(false, Ordering::SeqCst);
  result?;
  Ok(state.snapshot())
}

#[tauri::command]
pub async fn updater_check_and_download(
  app: AppHandle,
  state: State<'_, UpdaterState>,
) -> Result<UpdateStatus, String> {
  if state.busy.swap(true, Ordering::SeqCst) {
    return Ok(state.snapshot());
  }
  let result = async {
    check_for_update(&app, &state).await?;
    if state.with_mut(|s| s.phase == UpdatePhase::Available) {
      download_update(&app, &state).await?;
    }
    Ok::<(), String>(())
  }
  .await;
  state.busy.store(false, Ordering::SeqCst);
  result?;
  Ok(state.snapshot())
}

#[tauri::command]
pub fn updater_install_now(app: AppHandle, state: State<'_, UpdaterState>) -> Result<(), String> {
  let path = state.with_mut(|s| {
    if s.phase != UpdatePhase::Ready {
      return None;
    }
    s.phase = UpdatePhase::Installing;
    s.local_path.clone()
  });
  emit_status(&app, &state);
  let path = path.ok_or_else(|| "没有已下载的安装包，请先等待下载完成".to_string())?;
  install_package(Path::new(&path))?;
  clear_persisted_ready(&app);
  app.exit(0);
  Ok(())
}

/// 关闭应用：有待安装更新则安装，否则正常退出。
#[tauri::command]
pub fn updater_quit(app: AppHandle, state: State<'_, UpdaterState>) -> Result<(), String> {
  if handle_close_requested(&app, &state) {
    return Ok(());
  }
  app.exit(0);
  Ok(())
}

#[tauri::command]
pub fn updater_set_auto_check(state: State<'_, UpdaterState>, enabled: bool) -> UpdateStatus {
  state.with_mut(|s| s.auto_check = enabled);
  state.snapshot()
}

#[tauri::command]
pub fn updater_set_install_on_quit(state: State<'_, UpdaterState>, enabled: bool) -> UpdateStatus {
  state.install_on_quit.store(enabled, Ordering::SeqCst);
  state.snapshot()
}

#[tauri::command]
pub fn updater_list_mirrors() -> Vec<serde_json::Value> {
  DOWNLOAD_MIRRORS
    .iter()
    .map(|m| {
      serde_json::json!({
        "id": m.id,
        "label": m.label,
      })
    })
    .collect()
}

// ---------------------------------------------------------------------------
// 镜像测速：延迟（TTFB）+ 采样带宽 + 通畅度评分
// ---------------------------------------------------------------------------

/// 固定用 v0.1.0 Windows 安装包做采样（体积足够；只读前 512KB 即停）。
const PROBE_ASSET_URL: &str =
  "https://github.com/NewtSpeak/Newt-Desktop/releases/download/v0.1.0/owl-desktop-0.1.0-windows-x64-owl-desktop_0.1.0_x64-setup.exe";
/// 采样字节数上限（兼顾测速准确性与流量）
const PROBE_SAMPLE_BYTES: u64 = 512 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorProbeResult {
  pub id: String,
  pub label: String,
  /// 是否可达
  pub ok: bool,
  /// 首字节延迟（ms），失败为 null
  pub latency_ms: Option<u64>,
  /// 采样下载速度（字节/秒）
  pub speed_bps: Option<f64>,
  /// 通畅度 0–100
  pub quality: u8,
  /// 通畅度文案：优 / 良 / 中 / 差 / 不通
  pub quality_label: String,
  /// 实际采样字节
  pub bytes_sampled: u64,
  /// 失败原因
  pub error: Option<String>,
  /// 探测是否进行中（前端流式更新用）
  pub probing: bool,
}

impl MirrorProbeResult {
  fn pending(id: &str, label: &str) -> Self {
    Self {
      id: id.to_string(),
      label: label.to_string(),
      ok: false,
      latency_ms: None,
      speed_bps: None,
      quality: 0,
      quality_label: "…".into(),
      bytes_sampled: 0,
      error: None,
      probing: true,
    }
  }

  fn fail(id: &str, label: &str, err: impl Into<String>) -> Self {
    Self {
      id: id.to_string(),
      label: label.to_string(),
      ok: false,
      latency_ms: None,
      speed_bps: None,
      quality: 0,
      quality_label: "不通".into(),
      bytes_sampled: 0,
      error: Some(err.into()),
      probing: false,
    }
  }
}

fn quality_from_metrics(latency_ms: u64, speed_bps: f64) -> (u8, String) {
  // 延迟分 0–40
  let latency_score: u8 = if latency_ms <= 100 {
    40
  } else if latency_ms <= 250 {
    34
  } else if latency_ms <= 500 {
    28
  } else if latency_ms <= 1000 {
    20
  } else if latency_ms <= 2000 {
    12
  } else if latency_ms <= 5000 {
    6
  } else {
    2
  };

  // 速度分 0–60（MB/s）
  let mbps = speed_bps / (1024.0 * 1024.0);
  let speed_score: u8 = if mbps >= 8.0 {
    60
  } else if mbps >= 4.0 {
    52
  } else if mbps >= 2.0 {
    44
  } else if mbps >= 1.0 {
    36
  } else if mbps >= 0.5 {
    28
  } else if mbps >= 0.2 {
    18
  } else if mbps >= 0.05 {
    10
  } else {
    4
  };

  let q = latency_score.saturating_add(speed_score).min(100);
  let label = if q >= 85 {
    "优"
  } else if q >= 65 {
    "良"
  } else if q >= 40 {
    "中"
  } else if q >= 20 {
    "差"
  } else {
    "较差"
  };
  (q, label.into())
}

async fn probe_one_mirror(client: &reqwest::Client, mirror: &Mirror) -> MirrorProbeResult {
  let url = mirror.rewrite(PROBE_ASSET_URL);
  let started = std::time::Instant::now();

  let req = client
    .get(&url)
    .header("Range", format!("bytes=0-{}", PROBE_SAMPLE_BYTES.saturating_sub(1)))
    .timeout(PROBE_TIMEOUT);

  let resp = match req.send().await {
    Ok(r) => r,
    Err(e) => return MirrorProbeResult::fail(mirror.id, mirror.label, e.to_string()),
  };

  // TTFB ≈ 收到响应头的时间
  let latency_ms = started.elapsed().as_millis() as u64;
  let status = resp.status();
  if !(status.is_success() || status.as_u16() == 206) {
    return MirrorProbeResult::fail(
      mirror.id,
      mirror.label,
      format!("HTTP {status}"),
    );
  }

  let download_started = std::time::Instant::now();
  let mut stream = resp.bytes_stream();
  let mut sampled: u64 = 0;

  while let Some(chunk) = stream.next().await {
    match chunk {
      Ok(bytes) => {
        sampled += bytes.len() as u64;
        if sampled >= PROBE_SAMPLE_BYTES {
          break;
        }
      }
      Err(e) => {
        if sampled == 0 {
          return MirrorProbeResult::fail(mirror.id, mirror.label, e.to_string());
        }
        // 已有部分数据：用已采样计算速度
        break;
      }
    }
  }

  if sampled < 1024 {
    return MirrorProbeResult::fail(
      mirror.id,
      mirror.label,
      format!("响应过小（{sampled} 字节）"),
    );
  }

  let elapsed = download_started.elapsed().as_secs_f64().max(0.001);
  // 总耗时含 TTFB 时速度会偏低；带宽用「收 body」阶段更贴近下载体感
  let speed_bps = sampled as f64 / elapsed;
  let (quality, quality_label) = quality_from_metrics(latency_ms, speed_bps);

  MirrorProbeResult {
    id: mirror.id.to_string(),
    label: mirror.label.to_string(),
    ok: true,
    latency_ms: Some(latency_ms),
    speed_bps: Some(speed_bps),
    quality,
    quality_label,
    bytes_sampled: sampled,
    error: None,
    probing: false,
  }
}

/// 依次探测全部镜像；每完成一个推送 `updater://mirror-probe`，最后返回完整列表。
#[tauri::command]
pub async fn updater_probe_mirrors(app: AppHandle) -> Result<Vec<MirrorProbeResult>, String> {
  let client = reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .timeout(PROBE_TIMEOUT)
    .connect_timeout(Duration::from_secs(6))
    .redirect(reqwest::redirect::Policy::limited(8))
    .build()
    .map_err(|e| e.to_string())?;

  let mut results: Vec<MirrorProbeResult> = Vec::with_capacity(DOWNLOAD_MIRRORS.len());

  // 先推送「探测中」占位，前端可立刻画骨架
  for m in DOWNLOAD_MIRRORS {
    let pending = MirrorProbeResult::pending(m.id, m.label);
    let _ = app.emit("updater://mirror-probe", &pending);
  }

  for m in DOWNLOAD_MIRRORS {
    // 再次标记当前项 probing
    let _ = app.emit(
      "updater://mirror-probe",
      &MirrorProbeResult::pending(m.id, m.label),
    );
    let result = probe_one_mirror(&client, m).await;
    let _ = app.emit("updater://mirror-probe", &result);
    results.push(result);
  }

  // 全部完成事件（前端可用来收尾）
  let _ = app.emit("updater://mirror-probe-done", &results);
  Ok(results)
}
