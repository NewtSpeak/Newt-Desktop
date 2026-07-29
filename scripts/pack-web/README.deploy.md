# Owl Desktop Web 前端包

本压缩包是 **Newt-Desktop** 的纯前端静态构建产物（SPA，`ssr: false`），可独立部署到任意静态站点托管。

## 部署方式

将解压后的全部文件放到网站根目录（或子路径，需配合反向代理改写）。

### Nginx 示例

```nginx
server {
  listen 80;
  server_name chat.example.com;
  root /var/www/owl-desktop-web;
  index index.html;

  # SPA：未知路径回退 index.html
  location / {
    try_files $uri $uri/ /index.html;
  }

  # 静态资源长缓存
  location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
```

### 本地预览

```bash
# Python
python3 -m http.server 4173 --directory .

# 或 npx
npx serve -s .
```

## 注意

- 本包**不包含** Tauri 桌面壳；仅浏览器访问。
- 需能访问你的 Newt-Server（API / Gateway / 媒体信令），在客户端设置里配置服务器地址。
- 若部署在子路径（如 `/app/`），请重新构建并配置 base path（默认按根路径 `/` 构建）。
