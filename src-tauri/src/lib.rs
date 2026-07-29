// 安全存储（keyring）：refresh token 等敏感值走 OS 级凭证库
// （macOS Keychain / Windows Credential Manager / Linux Secret Service）。
// service 固定为应用标识，key 作为凭证的 user 字段。
//
// 深链：tauri-plugin-deep-link 注册 newtspeak://；
// 单实例：二次启动/深链唤起时聚焦已有窗口，并把 argv 中的 URL 发给前端。

mod activity;
mod discord_rpc;

use tauri::{AppHandle, Emitter, Manager};

const SECURE_STORAGE_SERVICE: &str = "com.newtspeak.desktop";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(SECURE_STORAGE_SERVICE, key).map_err(|e| e.to_string())
}

/// 读取安全存储；不存在返回 Ok(None)，其余错误返回 Err。
#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
  let entry = keyring_entry(&key)?;
  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

/// 写入（覆盖）安全存储。
#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
  let entry = keyring_entry(&key)?;
  entry.set_password(&value).map_err(|e| e.to_string())
}

/// 删除安全存储条目；不存在视为成功（幂等）。
#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
  let entry = keyring_entry(&key)?;
  match entry.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

/// 从二次启动参数中提取疑似深链 / URL，转发给前端。
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
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      forward_deep_link_args(app, &argv);
    }))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
        // 开发模式自动打开 WebView 开发者工具，便于排查白屏/卡加载
        #[cfg(debug_assertions)]
        {
          if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
          }
        }
      }
      // Discord RPC 兼容监听（无 Discord 占用管道时生效）
      discord_rpc::start_discord_rpc_server();
      Ok(())
    })
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
