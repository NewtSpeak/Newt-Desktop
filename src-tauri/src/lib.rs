// 安全存储：
// - 桌面：OS 级凭证库（macOS Keychain / Windows Credential Manager / Linux Secret Service）
// - 移动端：应用私有目录下的 secure_kv.json（首期可用；后续可换 Android Keystore）
// service 固定为应用标识，key 作为凭证的 user 字段。
//
// 深链：tauri-plugin-deep-link 注册 newtspeak://；
// 单实例（仅桌面）：二次启动/深链唤起时聚焦已有窗口，并把 argv 中的 URL 发给前端。

mod activity;
mod discord_rpc;
mod voice_overlay;

#[cfg(desktop)]
mod updater;

#[cfg(mobile)]
use std::collections::HashMap;
#[cfg(mobile)]
use std::fs;
#[cfg(mobile)]
use std::path::PathBuf;
#[cfg(mobile)]
use std::sync::Mutex;

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
#[cfg(desktop)]
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
#[cfg(mobile)]
use tauri::Manager;

// ---------------------------------------------------------------------------
// 桌面：keyring
// ---------------------------------------------------------------------------

#[cfg(desktop)]
const SECURE_STORAGE_SERVICE: &str = "com.newtspeak.desktop";

#[cfg(desktop)]
fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(SECURE_STORAGE_SERVICE, key).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 移动端：应用私有目录 KV（JSON 文件）
// ---------------------------------------------------------------------------

#[cfg(mobile)]
static MOBILE_SECURE_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

#[cfg(mobile)]
fn mobile_store_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("secure_kv.json"))
}

#[cfg(mobile)]
fn mobile_load(app: &AppHandle) -> Result<HashMap<String, String>, String> {
  if let Ok(guard) = MOBILE_SECURE_CACHE.lock() {
    if let Some(ref map) = *guard {
      return Ok(map.clone());
    }
  }
  let path = mobile_store_path(app)?;
  let map = if path.exists() {
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())?
  } else {
    HashMap::new()
  };
  if let Ok(mut guard) = MOBILE_SECURE_CACHE.lock() {
    *guard = Some(map.clone());
  }
  Ok(map)
}

#[cfg(mobile)]
fn mobile_save(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
  let path = mobile_store_path(app)?;
  let data = serde_json::to_string(map).map_err(|e| e.to_string())?;
  fs::write(path, data).map_err(|e| e.to_string())?;
  if let Ok(mut guard) = MOBILE_SECURE_CACHE.lock() {
    *guard = Some(map.clone());
  }
  Ok(())
}

/// 读取安全存储；不存在返回 Ok(None)，其余错误返回 Err。
#[tauri::command]
fn secure_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
  #[cfg(desktop)]
  {
    let _ = &app;
    let entry = keyring_entry(&key)?;
    return match entry.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(e) => Err(e.to_string()),
    };
  }
  #[cfg(mobile)]
  {
    let map = mobile_load(&app)?;
    Ok(map.get(&key).cloned())
  }
}

/// 写入（覆盖）安全存储。
#[tauri::command]
fn secure_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let _ = &app;
    let entry = keyring_entry(&key)?;
    return entry.set_password(&value).map_err(|e| e.to_string());
  }
  #[cfg(mobile)]
  {
    let mut map = mobile_load(&app)?;
    map.insert(key, value);
    mobile_save(&app, &map)
  }
}

/// 删除安全存储条目；不存在视为成功（幂等）。
#[tauri::command]
fn secure_delete(app: AppHandle, key: String) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let _ = &app;
    let entry = keyring_entry(&key)?;
    return match entry.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(e) => Err(e.to_string()),
    };
  }
  #[cfg(mobile)]
  {
    let mut map = mobile_load(&app)?;
    map.remove(&key);
    mobile_save(&app, &map)
  }
}

/// 从二次启动参数中提取疑似深链 / URL，转发给前端。
#[cfg(desktop)]
fn forward_deep_link_args(app: &AppHandle, argv: &[String]) {
  let urls: Vec<String> = argv
    .iter()
    .skip(1) // argv[0] 通常是可执行路径
    .filter(|a| {
      let s = a.as_str();
      s.contains("://")
        && (s.starts_with("newtspeak:")
          || s.starts_with("http://")
          || s.starts_with("https://"))
    })
    .cloned()
    .collect();
  if !urls.is_empty() {
    let _ = app.emit("owl://deep-link", urls);
  }
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_focus();
    let _ = window.unminimize();
    let _ = window.show();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[allow(unused_mut)] // desktop 会链式挂 single-instance / manage / handler
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_deep_link::init())
    // Android 语音悬浮窗 + 前台服务；其它平台 no-op
    .plugin(voice_overlay::init());

  // 单实例仅桌面；Android/iOS 无此插件
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      forward_deep_link_args(app, &argv);
    }));
    builder = builder.manage(updater::UpdaterState::new());
  }

  builder = builder.setup(|app| {
    if cfg!(debug_assertions) {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      // 开发模式自动打开 WebView 开发者工具（桌面）；移动端无 devtools API
      #[cfg(all(debug_assertions, desktop))]
      {
        if let Some(window) = app.get_webview_window("main") {
          window.open_devtools();
        }
      }
    }
    // Discord RPC 兼容监听（仅桌面；无 Discord 占用管道时生效）
    #[cfg(desktop)]
    discord_rpc::start_discord_rpc_server();

    // 系统托盘：使用 Newt-assets/logo.png 生成的 tray-icon（见 tauri.conf.json trayIcon）
    // 左键单击 / 双击 → 显示并聚焦主窗口
    #[cfg(desktop)]
    {
      let handle = app.handle().clone();
      app.on_tray_icon_event(move |_tray, event| {
        let show = match event {
          TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } => true,
          TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
          } => true,
          _ => false,
        };
        if show {
          if let Some(window) = handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
          }
        }
      });
    }

    // 应用内更新：恢复已下载包 + 10 分钟轮询检测/预下载
    #[cfg(desktop)]
    updater::bootstrap(app.handle());

    Ok(())
  });

  #[cfg(desktop)]
  {
    builder = builder.invoke_handler(tauri::generate_handler![
      secure_get,
      secure_set,
      secure_delete,
      activity::list_running_apps,
      activity::get_now_playing,
      activity::get_foreground_app,
      activity::extract_app_icon,
      discord_rpc::get_rpc_activity,
      updater::updater_get_status,
      updater::updater_check,
      updater::updater_download,
      updater::updater_check_and_download,
      updater::updater_install_now,
      updater::updater_quit,
      updater::updater_set_auto_check,
      updater::updater_set_install_on_quit,
      updater::updater_list_mirrors,
      updater::updater_probe_mirrors,
    ]);

    builder
      .build(tauri::generate_context!())
      .expect("error while building tauri application")
      .run(|app_handle, event| {
        if let RunEvent::WindowEvent {
          label,
          event: WindowEvent::CloseRequested { api, .. },
          ..
        } = &event
        {
          if label == "main" {
            let state = app_handle.state::<updater::UpdaterState>();
            if updater::handle_close_requested(app_handle, state.inner()) {
              api.prevent_close();
            }
          }
        }
      });
    return;
  }

  #[cfg(mobile)]
  {
    builder
      .invoke_handler(tauri::generate_handler![
        secure_get,
        secure_set,
        secure_delete,
        activity::list_running_apps,
        activity::get_now_playing,
        activity::get_foreground_app,
        activity::extract_app_icon,
        discord_rpc::get_rpc_activity,
      ])
      .run(tauri::generate_context!())
      .expect("error while running tauri application");
  }
}
