use serde::{Deserialize, Serialize};

// 与 app/lib/client-log-queue.ts 的上限对应（client-log-queue.test.ts 交叉校验）：
// 前端一批最多 MAX_QUEUE(400) 条 + 1 条丢弃提示；消息截断到 4000 个 UTF-16 单元再加后缀。
const MAX_BATCH_ENTRIES: usize = 401;
const MAX_MESSAGE_CHARS: usize = 4096;
const MAX_LOCATION_CHARS: usize = 512;

#[derive(Debug, PartialEq)]
struct LogConfig {
  global: log::LevelFilter,
  app: log::LevelFilter,
}

/// 未设置或无法识别 NEWT_LOG 时：全局 info；本应用与 webview 开发构建为 debug，正式版只开 info。
fn config_from_value(value: Option<&str>, debug_build: bool) -> Option<LogConfig> {
  let default = LogConfig {
    global: log::LevelFilter::Info,
    app: if debug_build {
      log::LevelFilter::Debug
    } else {
      log::LevelFilter::Info
    },
  };
  let level = match value.unwrap_or("").trim().to_ascii_lowercase().as_str() {
    "off" | "none" | "0" | "false" => return None,
    "trace" => log::LevelFilter::Trace,
    "debug" => log::LevelFilter::Debug,
    "info" => log::LevelFilter::Info,
    "warn" | "warning" => log::LevelFilter::Warn,
    "error" => log::LevelFilter::Error,
    _ => return Some(default),
  };
  Some(LogConfig {
    global: level,
    app: level,
  })
}

pub fn builder_from_env() -> Option<tauri_plugin_log::Builder> {
  let value = std::env::var("NEWT_LOG").ok();
  let config = config_from_value(value.as_deref(), cfg!(debug_assertions))?;
  Some(
    tauri_plugin_log::Builder::default()
      .level(config.global)
      .level_for("app_lib", config.app)
      .level_for("webview", config.app)
      .targets([
        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
          file_name: Some("newt-desktop".into()),
        }),
        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
      ])
      .max_file_size(8 * 1024 * 1024)
      .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3)),
  )
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientLogLevel {
  Debug,
  Info,
  Warn,
  Error,
}

impl ClientLogLevel {
  fn as_level(&self) -> log::Level {
    match self {
      Self::Debug => log::Level::Debug,
      Self::Info => log::Level::Info,
      Self::Warn => log::Level::Warn,
      Self::Error => log::Level::Error,
    }
  }
}

#[derive(Deserialize)]
pub struct ClientLogEntry {
  level: ClientLogLevel,
  message: String,
  location: Option<String>,
  repeats: Option<u32>,
}

impl std::fmt::Display for ClientLogEntry {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    if let Some(location) = &self.location {
      write!(f, "[{location}] ")?;
    }
    write!(f, "{}", self.message)?;
    if let Some(repeats) = self.repeats.filter(|count| *count > 0) {
      write!(f, " [repeated {repeats} more times]")?;
    }
    Ok(())
  }
}

fn validate_batch(entries: &[ClientLogEntry]) -> Result<(), String> {
  if entries.len() > MAX_BATCH_ENTRIES
    || entries.iter().any(|entry| {
      entry.message.chars().count() > MAX_MESSAGE_CHARS
        || entry
          .location
          .as_ref()
          .is_some_and(|location| location.chars().count() > MAX_LOCATION_CHARS)
    })
  {
    return Err("Client log batch exceeds limits".into());
  }
  Ok(())
}

/// webview 日志的最低生效级别，前端据此决定转发哪些级别；
/// NEWT_LOG=off（未注册 logger）时返回 None，前端会还原 console、不再转发。
#[tauri::command]
pub fn client_log_level() -> Option<ClientLogLevel> {
  [
    ClientLogLevel::Debug,
    ClientLogLevel::Info,
    ClientLogLevel::Warn,
    ClientLogLevel::Error,
  ]
  .into_iter()
  .find(|level| log::log_enabled!(target: "webview", level.as_level()))
}

#[tauri::command]
pub fn client_log_batch(entries: Vec<ClientLogEntry>, flush: bool) -> Result<(), String> {
  validate_batch(&entries)?;
  for entry in entries {
    log::log!(target: "webview", entry.level.as_level(), "{entry}");
  }
  if flush {
    log::logger().flush();
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn explicit_levels_apply_to_all_targets() {
    for debug_build in [true, false] {
      for (input, expected) in [
        ("trace", log::LevelFilter::Trace),
        ("debug", log::LevelFilter::Debug),
        ("info", log::LevelFilter::Info),
        ("warn", log::LevelFilter::Warn),
        (" ERROR ", log::LevelFilter::Error),
      ] {
        assert_eq!(
          config_from_value(Some(input), debug_build),
          Some(LogConfig {
            global: expected,
            app: expected
          })
        );
      }
    }
  }

  #[test]
  fn defaults_follow_build_kind_and_disable_aliases_work() {
    for (debug_build, app) in [
      (true, log::LevelFilter::Debug),
      (false, log::LevelFilter::Info),
    ] {
      for input in [None, Some(""), Some("invalid")] {
        assert_eq!(
          config_from_value(input, debug_build),
          Some(LogConfig {
            global: log::LevelFilter::Info,
            app,
          })
        );
      }
    }
    for input in ["off", "NONE", "0", "false"] {
      assert_eq!(config_from_value(Some(input), false), None);
    }
  }

  #[test]
  fn level_is_none_without_logger() {
    assert_eq!(client_log_level(), None);
  }

  #[test]
  fn batch_protocol_preserves_level_location_and_repeat_count() {
    let entries: Vec<ClientLogEntry> = serde_json::from_value(serde_json::json!([
      { "level": "error", "message": "failed", "location": "app/test.ts:1:2", "repeats": 3 },
      { "level": "debug", "message": "ready" }
    ]))
    .unwrap();
    assert_eq!(entries[0].level.as_level(), log::Level::Error);
    assert_eq!(
      entries[0].to_string(),
      "[app/test.ts:1:2] failed [repeated 3 more times]"
    );
    assert_eq!(entries[1].to_string(), "ready");
    assert!(validate_batch(&entries).is_ok());
  }

  #[test]
  fn oversized_batches_are_rejected_before_writing() {
    let entries: Vec<ClientLogEntry> = serde_json::from_value(serde_json::json!([
      { "level": "info", "message": "x".repeat(MAX_MESSAGE_CHARS + 1) }
    ]))
    .unwrap();
    assert!(validate_batch(&entries).is_err());
    let entries: Vec<ClientLogEntry> = serde_json::from_value(serde_json::Value::Array(
      vec![serde_json::json!({ "level": "info", "message": "x" }); MAX_BATCH_ENTRIES + 1],
    ))
    .unwrap();
    assert!(validate_batch(&entries).is_err());
    assert!(client_log_batch(Vec::new(), true).is_ok());
  }
}
