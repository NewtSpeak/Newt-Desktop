# Newt-Desktop

NewtSpeak **用户端**：桌面应用（Tauri）与可独立部署的 **Web 前端包**。  
产品体验对标 **Discord / KOOK**：多服务器、文本/语音、RBAC、舞台、屏幕共享、搜索与社交。

```text
┌─────────────┐   REST + Gateway WS    ┌─────────────┐
│ Newt-Desktop │ ─────────────────────► │ Newt-Server  │  控制面
│  Tauri/Web  │                        └──────┬──────┘
│             │   WSS + WebRTC (UDP)          │ mTLS
│             │ ─────────────────────► ┌──────▼──────┐
└─────────────┘                        │  Newt-SFU    │  媒体面
                                       └─────────────┘
```

- 业务权限 **以 Server 为准**；本地权限计算仅用于 UI 反馈  
- 音视频 **不经 Server**，直连被调度的 SFU；TURN 仅作 NAT 兜底  
- 媒体鉴权：短时 **Media Token**（TTL 2–5 分钟，caps 最小集）

## 功能地图

| 域 | 要点 |
|----|------|
| **账号** | 登录/资料、在线状态、多设备、OAuth 授权页（配合 Agent） |
| **服务器** | 创建/加入/邀请、侧栏、服设置、成员与节点池入口 |
| **频道** | 文本/语音/分类/舞台、排序、可见性、密码房 |
| **权限** | 角色、Overwrite、层级；无权限频道视为不存在（404） |
| **消息** | Markdown、@、编辑/删除、反应、附件、Bot 卡片与流式 |
| **搜索** | 全站消息搜索与跳转 |
| **语音** | 进房、静音/PTT、设备、token 续签、热迁移无感换节点 |
| **舞台** | 麦序、申请/抱麦、容量与自动禁说策略 |
| **屏幕共享** | Go Live 式共享与观看、动态配额 |
| **社交** | 好友、隐私、DM/群、通知收件箱 |
| **贴图** | 表情/贴图包、反应、服 ban 感知 |
| **设置** | 用户设置、每服个人偏好、本地多模型降噪（DTLN 等） |
| **深链** | `newtspeak://`（OAuth 设备码、邀请、注册等） |

完整需求文档见 [`docs/`](./docs/)，入口：[00-产品总览与功能地图](./docs/00-产品总览与功能地图.md)。

## 技术栈

| 层 | 技术 |
|----|------|
| UI | React Router 7、TypeScript、Vite |
| 桌面壳 | Tauri 2（深链、通知、单实例） |
| 状态 | 客户端 stores + Gateway 事件 |
| 媒体 | WebRTC；本地降噪 wasm/tflite 资源 |
| 包管理 | Bun / npm |

## 仓库结构

```text
Newt-Desktop/
├── app/                 # 前端应用
│   ├── components/      # UI
│   ├── lib/             # API、媒体、权限、工具
│   ├── stores/          # 客户端状态
│   └── routes/          # 路由页
├── src-tauri/           # Tauri 原生壳
├── public/              # 静态资源（含 dtln）
├── docs/                # 产品功能文档 00–23
├── scripts/             # 打包、OAuth e2e、CI
└── package.json
```

## 快速开始

```bash
# 依赖：Bun 或 Node、Rust（仅 Tauri）
bun install          # 或 npm install

# 纯 Web 开发（对接已运行的 Server）
bun run dev

# 桌面壳
bun run dev:tauri

# 生产 Web 构建
bun run build

# 打可部署静态包
bun run pack:web
```

配置 API 基址等以项目内环境/设置为准（指向你的 `newt-panel` 域名或本地 Server）。

## 文档与权威性

| 文档 | 说明 |
|------|------|
| [docs/00-…](./docs/00-产品总览与功能地图.md) | 功能地图与硬约束 |
| [docs/](./docs/) | 分域产品说明 |
| `Newt-Server/docs/设计讨论/` | **冲突时以服务端定稿为准** |
| `Newt-Server/docs/协议/` | Media Token、关闭码、信令 |
| [scripts/pack-web/README.deploy.md](./scripts/pack-web/README.deploy.md) | Web 包部署 |

## 相关仓库

| 仓库 | 关系 |
|------|------|
| [Newt-Server](https://github.com/NewtSpeak/Newt-Server) | 控制面 API / Gateway |
| [Newt-SFU](https://github.com/NewtSpeak/Newt-SFU) | 语音与屏幕媒体 |
| [Newt-Agent](https://github.com/NewtSpeak/Newt-Agent) | 深链 OAuth 设备码登录 |
| [NewtSpeak](https://github.com/NewtSpeak/NewtSpeak) | 安装包与 Web zip 发布 |

## 许可证

以仓库内 `LICENSE*`（若存在）及组织约定为准；商业授权见各核心仓说明。
