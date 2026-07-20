# Owl-Desktop

OwlSpeak 桌面客户端（用户端）。产品能力严格对标 **Discord / KOOK**：多服务器（Guild）、文本/语音子频道、细粒度 RBAC 权限、舞台模式、屏幕共享、全系统搜索。

## 相关仓库

| 仓库 | 职责 |
|------|------|
| **Owl-Server** | 控制面：账号、服务器/频道、RBAC、消息、调度与编排（REST API + Gateway 实时事件） |
| **Owl-SFU** | 媒体面：WebRTC 音频/屏幕轨转发、级联、热迁移执行（WSS 信令） |
| **Owl-Desktop**（本仓） | 用户端：全部用户可见功能与交互 |

## 文档

客户端全部功能需求与开发文档见 [`docs/`](./docs/)，入口为 [docs/00-产品总览与功能地图.md](./docs/00-产品总览与功能地图.md)。

## 权威性约定

- 客户端文档与服务端设计文档（`Owl-Server/docs/设计讨论/`，编号越大越权威，当前最高 15）冲突时，**以服务端定稿文档为准**。
- 协议细节（Media Token、WSS 信令、关闭码）以 `Owl-Server/docs/协议/README.md` 为准。
