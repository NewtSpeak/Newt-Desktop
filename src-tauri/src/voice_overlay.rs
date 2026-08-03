//! Android 语音悬浮窗 / 后台前台服务桥接。
//! 桌面端为空插件（no-op），移动端注册 Kotlin `VoiceOverlayPlugin`。

use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

/// 插件名：前端 `invoke('plugin:voice-overlay|…')` / `addPluginListener('voice-overlay', …)`
pub const PLUGIN_NAME: &str = "voice-overlay";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new(PLUGIN_NAME)
    .setup(|_app, api| {
      #[cfg(target_os = "android")]
      {
        // package = gen/android 中 Kotlin 包名；class = 无包前缀类名
        let _handle = api.register_android_plugin("com.newtspeak.desktop", "VoiceOverlayPlugin")?;
        let _ = _handle;
      }
      #[cfg(not(target_os = "android"))]
      {
        let _ = api;
      }
      Ok(())
    })
    .build()
}
