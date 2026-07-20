// 安全存储（keyring）：refresh token 等敏感值走 OS 级凭证库
// （macOS Keychain / Windows Credential Manager / Linux Secret Service）。
// service 固定为应用标识，key 作为凭证的 user 字段。

const SECURE_STORAGE_SERVICE: &str = "com.owlspeak.desktop";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![secure_get, secure_set, secure_delete])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
