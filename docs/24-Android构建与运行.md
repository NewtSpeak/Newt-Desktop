# 24 Android 构建与运行（Tauri 2）

| 字段 | 内容 |
|------|------|
| **文档编号** | Newt-Desktop 24 |
| **日期** | 2026-08-02 |
| **状态** | 首期脚手架 |
| **依赖** | Tauri 2.11、JDK 17+、Android SDK/NDK |

---

## 1. 当前工程已做的适配

| 项 | 说明 |
|----|------|
| `Cargo.toml` | `keyring`、`tauri-plugin-single-instance` 仅桌面 target |
| `lib.rs` | 移动端安全存储回退到应用私有目录 `secure_kv.json`；单实例/DevTools/Discord RPC 仅桌面 |
| `discord_rpc.rs` | 排除 Android/iOS（避免误用 unix socket） |
| `activity.rs` | 非桌面 OS 已返回空列表 / None |
| `tauri.conf.json` | `bundle.android`、`deep-link.mobile` 自定义 scheme `newtspeak://` |
| `tauri.android.conf.json` | 移动端窗口全屏等覆盖 |
| `capabilities/default.json` | 包含 `android` / `iOS` 平台 |
| npm scripts | `android:init` / `dev:android` / `build:android` |

首期目标是 **能编译安装并跑通登录/文本/进语音**；桌面专属能力（活动检测、Discord RPC、自定义标题栏拖拽）在安卓上自动降级。

---

## 2. 本机环境要求

### 2.1 必备

| 组件 | 建议 |
|------|------|
| **Rust** | 已安装；再加 Android 目标 |
| **Node / Bun** | 与桌面一致 |
| **JDK** | **17** 推荐（JDK 24 可能与部分 Android Gradle 插件不兼容，优先装 Temurin 17） |
| **Android SDK** | API 26+（`minSdkVersion: 26`） |
| **Android NDK** | **必装**；未设置 `NDK_HOME` 时 `tauri android init/dev` 会直接失败 |
| **build-tools / platform-tools** | 必装 |
| **设备/模拟器** | USB 调试 或 AVD |

推荐用 **Android Studio → Settings → Languages & Frameworks → Android SDK** 勾选：

- SDK Platforms：Android 14/15（34/35）
- SDK Tools：Android SDK Build-Tools、NDK (Side by side)、Android SDK Command-line Tools、Android SDK Platform-Tools

装完后确认目录类似：

```text
%LOCALAPPDATA%\Android\Sdk\ndk\<version>\
%LOCALAPPDATA%\Android\Sdk\build-tools\<version>\
%LOCALAPPDATA%\Android\Sdk\platform-tools\
```

### 2.2 环境变量（Windows PowerShell 示例）

用户级变量在安装脚本中已写入（`ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME`）。  
**新开终端**即可生效；当前会话可：

```powershell
cd Newt-Desktop
. .\scripts\android-env.ps1
```

手动设置示例：

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
# NDK 目录名以本机为准，例如 27.0.12077973
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.0.12077973"
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
```

用 Android Studio → SDK Manager 安装：

- Android SDK Platform 34/35  
- Android SDK Build-Tools  
- NDK (Side by side)  
- Android SDK Command-line Tools  
- Android Emulator（可选）

### 2.3 Rust Android 目标

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

---

## 3. 初始化 Android 工程（一次性）

在 `Newt-Desktop` 根目录：

```bash
bun install   # 或 npm install
bun run android:init
# 等价：npx tauri android init
```

会生成：

```text
src-tauri/gen/android/
```

该目录应纳入版本控制（或团队约定是否提交）；若本地生成，**初始化后立刻补权限**：

```bash
bun run android:patch-manifest
# 或：node scripts/patch-android-manifest.mjs
```

---

## 4. Android 权限（语音 / 网络 / 通知）

编辑生成后的清单（路径以 CLI 生成为准）：

`src-tauri/gen/android/app/src/main/AndroidManifest.xml`

在 `<manifest>` 内确保有：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

调试连本机 HTTP Server 时，可在 `application` 上允许明文：

```xml
android:usesCleartextTraffic="true"
```

生产务必 HTTPS，并去掉或按 build type 收紧。

运行时麦克风/通知权限仍需 WebView / 系统弹窗授权；若后续发现 WebRTC 无法采麦，再补 `tauri-plugin-dialog` 或原生权限请求插件。

---

## 5. 开发与构建

```bash
# 开发：自动选局域网 IP + adb reverse + 装到设备
bun run dev:android

# 强制指定电脑 IP（Clash TUN 误选 198.18.x 时）
bun run dev:android -- --host 192.168.1.28

# 正式 APK/AAB
bun run build:android
```

### 真机白屏 / logcat 出现 `Failed to request http://198.18.0.x:1420`

| 原因 | Tauri 把 `devUrl` 替换成了 **Clash TUN / 虚拟网卡 IP**，手机访问不到 |
| 处理 | 1. 用 `bun run dev:android`（`scripts/android-dev.mjs` 会避开 198.18.x）<br>2. 或 `bun run dev:android -- --host 192.168.x.x`<br>3. 确认手机与电脑同一 Wi‑Fi；公司隔离网络需 `adb reverse`（脚本已做 1420） |

```bash
# 手动 reverse（脚本已自动执行）
adb reverse tcp:1420 tcp:1420
adb reverse tcp:8080 tcp:8080
```

API 基址：在应用设置里指向手机可达的 Newt-Server；本机 Server 可用 `adb reverse tcp:8080`。

---

## 6. 功能预期（首期）

| 能力 | Android |
|------|---------|
| 登录 / Gateway / 文本频道 | 应可用（WebView） |
| 深链 `newtspeak://` | 已配置 mobile scheme；需真机验证 |
| 通知 | 插件已挂；系统权限需用户允许 |
| 安全存储（token） | 应用私有 JSON，非硬件 Keystore |
| 语音 WebRTC | 依赖权限 + Chromium WebView 版本；建议 Android 10+ |
| **语音后台 + 悬浮窗** | 进语音后自动起前台服务；悬浮窗显示说话人与开/闭麦（需「显示在其他应用上层」权限） |
| 屏幕共享 / 活动检测 / Discord RPC | 不可用或降级 |

### 6.1 语音悬浮窗

| 项 | 说明 |
|----|------|
| 触发 | 进语音（`phase` 离开 idle/joining）自动 `start`；退语音 `stop` |
| 展示 | 频道名、当前说话人、自己开麦/闭麦/闭听 |
| 操作 | 悬浮窗点按切换开闭麦；通知栏也可切换；「回到应用」拉回主界面 |
| 权限 | `SYSTEM_ALERT_WINDOW` + 通知 + 前台服务（microphone/mediaPlayback） |
| 实现 | `VoiceOverlayPlugin` / `VoiceBubbleService` / `app/lib/voice/android-overlay.ts` |

首次进语音若未授悬浮窗权限，会跳转系统设置页；授予后再次进语音即可显示。
| 自定义标题栏 | 移动端全屏，无窗口装饰逻辑 |

---

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| 找不到 SDK / NDK | 设置 `ANDROID_HOME`、`NDK_HOME`，SDK Manager 装全组件 |
| Gradle / JDK 报错 | 改用 **JDK 17** |
| `linker` / `cc` 失败 | 确认 NDK 与 `rustup target` 齐全 |
| **`ld.lld: cannot open D:\\...\\研发\\...` / Non-UTF-8 output** | **路径含中文**：NDK 的 lld 在 Windows 上无法打开非 ASCII 路径。已把 Cargo `target-dir` 固定到 `D:/tauri-target/newt-desktop`（见 `src-tauri/.cargo/config.toml`）。重新 `bun run dev:android`。若仍失败，用盘符联接把仓库映射到纯英文路径：`mklink /J D:\OwlSpeak D:\研发\OwlSpeak`，再从 `D:\OwlSpeak\Newt-Desktop` 构建 |
| **`Your project path contains non-ASCII characters`** | Android Gradle 默认禁止中文路径。已在 `src-tauri/gen/android/gradle.properties` 设置 `android.overridePathCheck=true`。**更稳妥**：始终从 `D:\OwlSpeak\Newt-Desktop` 构建（联接已建好） |
| 白屏 | 查 `devUrl` 是否对真机可达；`adb logcat` 看 WebView 错误 |
| 无法录音 | 清单权限 + 运行时授权 + 系统隐私里的麦克风开关 |
| 深链无反应 | 确认 `android:init` 后 manifest 含 deep-link intent；重装 app |

---

## 8. 后续可增强

1. Android Keystore / EncryptedSharedPreferences 替代 `secure_kv.json`  
2. 运行时权限插件（麦克风、通知）  
3. 移动端 UI 布局（侧栏、底栏）适配小屏  
4. 推送（FCM）替代纯本地通知  
5. iOS 对称工程（`tauri ios init`）

---

## 9. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-02 | 首期：条件编译、移动安全存储、深链/脚本与文档 |
