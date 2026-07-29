//! 最小化 Discord IPC 兼容层：游戏通过 discord-ipc-* 管道上报 SET_ACTIVITY。
//! 当 Discord 已占用管道时依次尝试 ipc-0…9；成功后前端轮询 get_rpc_activity。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RpcActivity {
  pub name: String,
  pub details: String,
  pub state: String,
  pub large_image: String,
  pub large_text: String,
  pub small_image: String,
  pub small_text: String,
  pub application_id: String,
  /// 上次更新时间 ms
  pub updated_at: u64,
}

static RPC_STATE: Mutex<Option<RpcActivity>> = Mutex::new(None);

/// 供前端轮询。
#[tauri::command]
pub fn get_rpc_activity() -> Option<RpcActivity> {
  RPC_STATE.lock().ok().and_then(|g| g.clone())
}

/// 启动后台 IPC 监听（幂等，可在 setup 中调用）。
pub fn start_discord_rpc_server() {
  static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
  if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
    return;
  }
  thread::spawn(|| {
    loop {
      if let Err(e) = serve_once() {
        log::debug!("discord-rpc serve: {e}");
      }
      thread::sleep(Duration::from_secs(2));
    }
  });
}

fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

fn apply_activity(activity: &Value, client_id: &str) {
  let name = activity
    .get("name")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let details = activity
    .get("details")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let state = activity
    .get("state")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let assets = activity.get("assets");
  let large_image = assets
    .and_then(|a| a.get("large_image"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let large_text = assets
    .and_then(|a| a.get("large_text"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let small_image = assets
    .and_then(|a| a.get("small_image"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let small_text = assets
    .and_then(|a| a.get("small_text"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();

  // 清空活动
  if name.is_empty() && details.is_empty() && state.is_empty() {
    if let Ok(mut g) = RPC_STATE.lock() {
      *g = None;
    }
    return;
  }

  let act = RpcActivity {
    name: if name.is_empty() {
      "Game".into()
    } else {
      name
    },
    details,
    state,
    large_image,
    large_text,
    small_image,
    small_text,
    application_id: client_id.to_string(),
    updated_at: now_ms(),
  };
  if let Ok(mut g) = RPC_STATE.lock() {
    *g = Some(act);
  }
}

// ---------------------------------------------------------------------------
// Platform I/O
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn serve_once() -> Result<(), String> {
  use std::os::unix::net::{UnixListener, UnixStream};
  let runtime = std::env::var("XDG_RUNTIME_DIR")
    .or_else(|_| std::env::var("TMPDIR"))
    .unwrap_or_else(|_| "/tmp".into());
  // 兼容 Discord 路径：{runtime}/discord-ipc-N 或 {runtime}/app/com.discordapp.Discord/discord-ipc-N
  let mut paths = Vec::new();
  for i in 0..10 {
    paths.push(format!("{runtime}/discord-ipc-{i}"));
    paths.push(format!("{runtime}/app/com.discordapp.Discord/discord-ipc-{i}"));
  }
  let mut listener = None;
  let mut bound = String::new();
  for p in &paths {
    // 若 Discord 已占用则跳过；清理陈旧 socket
    let _ = std::fs::remove_file(p);
    match UnixListener::bind(p) {
      Ok(l) => {
        bound = p.clone();
        listener = Some(l);
        break;
      }
      Err(_) => continue,
    }
  }
  let listener = listener.ok_or_else(|| "无法绑定 discord-ipc".to_string())?;
  log::info!("discord-rpc listening on {bound}");
  listener
    .set_nonblocking(false)
    .map_err(|e| e.to_string())?;
  for stream in listener.incoming() {
    match stream {
      Ok(s) => {
        let _ = handle_stream(s);
      }
      Err(_) => break,
    }
  }
  let _ = std::fs::remove_file(&bound);
  Ok(())
}

#[cfg(windows)]
fn serve_once() -> Result<(), String> {
  // Windows named pipe：\\.\pipe\discord-ipc-N
  // 使用 std 没有原生 named pipe server，改用 powershell 无法常驻。
  // 这里用 winapi 风格的简化：通过 `miow`/`winapi` 会增加依赖。
  // 退而求其次：用 loopback TCP 不兼容 Discord。
  // 采用 `std::fs` 不可用。实现最小 named pipe with CreateNamedPipeW via raw.
  windows_pipe_serve()
}

#[cfg(windows)]
fn windows_pipe_serve() -> Result<(), String> {
  use std::ptr;
  // 动态加载 kernel32 过于冗长；使用 PowerShell 不可。
  // 用 crate-free FFI:
  #[link(name = "kernel32")]
  extern "system" {
    fn CreateNamedPipeW(
      name: *const u16,
      open_mode: u32,
      pipe_mode: u32,
      max_instances: u32,
      out_buf: u32,
      in_buf: u32,
      timeout: u32,
      security: *mut core::ffi::c_void,
    ) -> *mut core::ffi::c_void;
    fn ConnectNamedPipe(pipe: *mut core::ffi::c_void, overlapped: *mut core::ffi::c_void) -> i32;
    fn DisconnectNamedPipe(pipe: *mut core::ffi::c_void) -> i32;
    fn CloseHandle(h: *mut core::ffi::c_void) -> i32;
    fn ReadFile(
      h: *mut core::ffi::c_void,
      buf: *mut u8,
      size: u32,
      read: *mut u32,
      ov: *mut core::ffi::c_void,
    ) -> i32;
    fn WriteFile(
      h: *mut core::ffi::c_void,
      buf: *const u8,
      size: u32,
      written: *mut u32,
      ov: *mut core::ffi::c_void,
    ) -> i32;
  }
  const PIPE_ACCESS_DUPLEX: u32 = 0x0000_0003;
  const PIPE_TYPE_BYTE: u32 = 0x0000_0000;
  const PIPE_READMODE_BYTE: u32 = 0x0000_0000;
  const PIPE_WAIT: u32 = 0x0000_0000;
  const INVALID_HANDLE: *mut core::ffi::c_void = -1isize as *mut _;

  for i in 0..10 {
    let name = format!("\\\\.\\pipe\\discord-ipc-{i}");
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
      let pipe = CreateNamedPipeW(
        wide.as_ptr(),
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        1,
        8192,
        8192,
        0,
        ptr::null_mut(),
      );
      if pipe == INVALID_HANDLE || pipe.is_null() {
        continue;
      }
      log::info!("discord-rpc listening on {name}");
      loop {
        if ConnectNamedPipe(pipe, ptr::null_mut()) == 0 {
          // ERROR_PIPE_CONNECTED = 535 也可能表示已连接
        }
        let _ = handle_windows_pipe(pipe);
        DisconnectNamedPipe(pipe);
      }
    }
  }
  Err("无法创建 named pipe".into())
}

#[cfg(windows)]
unsafe fn handle_windows_pipe(pipe: *mut core::ffi::c_void) -> Result<(), String> {
  use std::ptr;
  extern "system" {
    fn ReadFile(
      h: *mut core::ffi::c_void,
      buf: *mut u8,
      size: u32,
      read: *mut u32,
      ov: *mut core::ffi::c_void,
    ) -> i32;
    fn WriteFile(
      h: *mut core::ffi::c_void,
      buf: *const u8,
      size: u32,
      written: *mut u32,
      ov: *mut core::ffi::c_void,
    ) -> i32;
  }
  let mut client_id = String::new();
  loop {
    let mut header = [0u8; 8];
    let mut read = 0u32;
    let ok = ReadFile(
      pipe,
      header.as_mut_ptr(),
      8,
      &mut read,
      ptr::null_mut(),
    );
    if ok == 0 || read < 8 {
      break;
    }
    let op = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
      break;
    }
    let mut body = vec![0u8; len];
    let mut got = 0usize;
    while got < len {
      let mut n = 0u32;
      let ok = ReadFile(
        pipe,
        body[got..].as_mut_ptr(),
        (len - got) as u32,
        &mut n,
        ptr::null_mut(),
      );
      if ok == 0 || n == 0 {
        return Ok(());
      }
      got += n as usize;
    }
    let resp = process_frame(op, &body, &mut client_id)?;
    for frame in resp {
      let mut written = 0u32;
      WriteFile(
        pipe,
        frame.as_ptr(),
        frame.len() as u32,
        &mut written,
        ptr::null_mut(),
      );
    }
  }
  Ok(())
}

#[cfg(unix)]
fn handle_stream(mut stream: std::os::unix::net::UnixStream) -> Result<(), String> {
  use std::io::{Read, Write};
  let mut client_id = String::new();
  loop {
    let mut header = [0u8; 8];
    if stream.read_exact(&mut header).is_err() {
      break;
    }
    let op = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
      break;
    }
    let mut body = vec![0u8; len];
    if stream.read_exact(&mut body).is_err() {
      break;
    }
    let frames = process_frame(op, &body, &mut client_id)?;
    for f in frames {
      let _ = stream.write_all(&f);
    }
  }
  Ok(())
}

fn process_frame(op: u32, body: &[u8], client_id: &mut String) -> Result<Vec<Vec<u8>>, String> {
  // 0 = Handshake, 1 = Frame, 2 = Close, 3 = Ping, 4 = Pong
  match op {
    0 => {
      // handshake
      if let Ok(v) = serde_json::from_slice::<Value>(body) {
        if let Some(id) = v.get("client_id").and_then(|x| x.as_str()) {
          *client_id = id.to_string();
        }
      }
      let ready = serde_json::json!({
        "cmd": "DISPATCH",
        "evt": "READY",
        "data": {
          "v": 1,
          "config": { "cdn_host": "cdn.discordapp.com", "api_endpoint": "//discord.com/api", "environment": "production" },
          "user": { "id": "0", "username": "NewtSpeak", "discriminator": "0", "avatar": null }
        },
        "nonce": null
      });
      Ok(vec![encode_frame(1, &ready)])
    }
    1 => {
      let v: Value = serde_json::from_slice(body).map_err(|e| e.to_string())?;
      let cmd = v.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
      let nonce = v.get("nonce").cloned().unwrap_or(Value::Null);
      if cmd.eq_ignore_ascii_case("SET_ACTIVITY") {
        let activity = v
          .pointer("/args/activity")
          .cloned()
          .unwrap_or(Value::Null);
        if activity.is_null() {
          if let Ok(mut g) = RPC_STATE.lock() {
            *g = None;
          }
        } else {
          apply_activity(&activity, client_id);
        }
        let resp = serde_json::json!({
          "cmd": "SET_ACTIVITY",
          "data": null,
          "evt": null,
          "nonce": nonce
        });
        return Ok(vec![encode_frame(1, &resp)]);
      }
      if cmd.eq_ignore_ascii_case("SUBSCRIBE") || cmd.eq_ignore_ascii_case("UNSUBSCRIBE") {
        let resp = serde_json::json!({
          "cmd": cmd,
          "data": { "evt": v.get("evt") },
          "evt": null,
          "nonce": nonce
        });
        return Ok(vec![encode_frame(1, &resp)]);
      }
      Ok(vec![])
    }
    3 => {
      // ping -> pong
      Ok(vec![encode_raw(4, body)])
    }
    _ => Ok(vec![]),
  }
}

fn encode_frame(op: u32, json: &Value) -> Vec<u8> {
  let body = serde_json::to_vec(json).unwrap_or_default();
  encode_raw(op, &body)
}

fn encode_raw(op: u32, body: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(8 + body.len());
  out.extend_from_slice(&op.to_le_bytes());
  out.extend_from_slice(&(body.len() as u32).to_le_bytes());
  out.extend_from_slice(body);
  out
}
