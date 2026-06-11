# ManJyun × Jshaorii 私密情侣纪念站

一个自托管的双人纪念册，包含密码保护的前台、时间线、相册、情书、愿望、纪念日、音乐播放器和内容管理后台。

## 快速启动

电脑已安装 Docker Desktop 后，在项目目录运行：

```powershell
docker compose up -d --build
```

打开：

- 纪念册：<http://localhost:1314>
- 管理后台：<http://localhost:1314/admin>

默认密码已按要求转换成 bcrypt 哈希保存在本机 `.env`，源码和镜像中没有明文密码。

停止网站：

```powershell
docker compose down
```

查看运行状态：

```powershell
docker compose ps
docker compose logs -f love-journal
```

## 内容管理

后台可以管理：

- 纪念日：年度重复或单次日期、说明、显示状态和排序。
- 时间线：展示日期、准确日期、正文、配图、发布状态和排序。
- 相册：创建相册、批量上传照片、设置封面和删除照片。
- 情书：Markdown 编辑、实时预览、草稿与发布。
- 愿望：待实现/已完成、目标日期、完成日期和配图。
- 设置与音乐：双方资料、相识和恋爱日期、首页文字、背景音乐。

照片会生成网页图和缩略图。支持 JPEG、PNG、WebP，单张最大 15MB。音乐支持 MP3、M4A、OGG，最大 30MB。

## 数据与备份

所有持久化内容都在两个目录：

- `data/`：SQLite 数据库。
- `uploads/`：原图、网页图、缩略图和音乐。

备份时先停止容器，再复制这两个目录：

```powershell
docker compose stop
Copy-Item -Recurse data backups/data-$(Get-Date -Format yyyyMMdd-HHmmss)
Copy-Item -Recurse uploads backups/uploads-$(Get-Date -Format yyyyMMdd-HHmmss)
docker compose start
```

恢复时停止容器，将备份内容复制回 `data/` 和 `uploads/`，再启动容器。

## 更换密码

生成新的 bcrypt 哈希：

```powershell
npm run hash-password -- 你的新密码
```

把输出分别填入 `.env` 的 `SITE_PASSWORD_HASH` 或 `ADMIN_PASSWORD_HASH`。命令已经按 Docker Compose 要求处理 `$`，可以直接粘贴，然后重建：

```powershell
docker compose up -d --build
```

不要在 `.env` 中保存明文密码。

## 公网部署

直接暴露 `1314` 端口只适合局域网或测试。公网使用时应在容器前配置 Caddy、Nginx Proxy Manager 或 Nginx，并启用 HTTPS，然后将 `.env` 中：

```env
SECURE_COOKIES=true
TRUST_PROXY=true
```

修改后重启容器。请同时更换为更长的主页和后台密码。

## 本地开发

```powershell
npm install
$env:NODE_ENV="development"
npm run dev
```

Vite 开发地址为 <http://localhost:5173>，API 服务仍使用 `1314` 端口。
