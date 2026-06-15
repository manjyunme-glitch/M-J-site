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

- 首页编排：保留六个固定内容模块，并可重复添加双人问题抽卡、记忆配对和约会抽签；支持调整显示、顺序和模块文案。
- 纪念日：年度重复或单次日期、说明、显示状态和排序。
- 时间线：展示日期、准确日期、正文、配图、发布状态和排序。
- 相册：创建相册、批量上传照片、设置封面和删除照片。
- 照片管理：上传前填写展示名称、拍摄日期和说明，上传后可继续编辑；选图时显示缩略图预览。
- 情书：Markdown 编辑、实时预览、草稿与发布。
- 愿望：待实现/已完成、目标日期、完成日期和配图。
- 设置与音乐：双方资料、相识和恋爱日期、首页文字、背景音乐。
- 配置备份：将全部文案、内容结构、照片和音乐打包为本地 `.mjsite` 文件，也可读取备份并整体切换网站配置。
- 部署状态：后台总览可检查当前 Docker 构建与 GitHub 最新提交是否一致。

首页暗号卡片支持纸页翻面、信封展开、刮开视觉和票根抽出四种揭晓方式。互动小游戏只保留当前浏览器会话状态，不保存访客答案或公开排行。

照片会记录原始长宽并生成完整内容缩略图。前台会按横图、方图、竖图和手机长截图自动选择稳定画框，详情页可点开查看完整图片。支持 JPEG、PNG、WebP，单张最大 15MB。音乐支持 MP3、M4A、OGG，最大 30MB。中文文件名会按 UTF-8 保存，应用启动时也会尝试修复旧版本中可恢复的乱码文件名。

## 前台页面

认证后的前台采用独立页面结构：

- `/`：首页摘要与近期入口。
- `/stories`：完整故事时间线。
- `/gallery`、`/gallery/:albumId`：相册列表与照片页。
- `/letters`、`/letters/:letterId`：情书列表与正文。
- `/wishes`：愿望清单。

页面切换和滚动入场使用 GSAP 与 ScrollTrigger，系统开启“减少动态效果”时会自动停用位移和滚动动画。

## 数据与备份

后台“配置备份”可以直接下载一个完整 `.mjsite` 文件。文件包含数据库中的全部自定义内容，以及当前使用的原图、网页图、缩略图和音乐；不会包含 `.env`、登录密码哈希或 GitHub Token。读取本地备份后，后台会先显示创建时间和内容数量，只有输入确认文字后才会覆盖当前网站。

适合在重写时间线、批量调整首页文案或尝试不同网站内容方案前保存一个版本。多个 `.mjsite` 文件可以分别保留，需要时从后台切换。

服务器目录级备份仍可作为额外保障。所有持久化内容都在两个目录：

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

## GitHub 更新检查

默认检查 `manjyunme-glitch/M-J-site` 的 `main` 分支。公开仓库无需额外配置；私有仓库需要在 `.env` 中填写只读的 fine-grained token：

```env
GITHUB_REPOSITORY=manjyunme-glitch/M-J-site
GITHUB_BRANCH=main
GITHUB_TOKEN=github_pat_xxx
APP_HTTP_PROXY=http://192.168.0.113:9890
APP_HTTPS_PROXY=http://192.168.0.113:9890
APP_NO_PROXY=localhost,127.0.0.1,::1
DATA_PATH=/share/DockerData/M-J-site/data
UPLOAD_PATH=/share/DockerData/M-J-site/uploads
```

Token 只需授予目标仓库的 `Contents: Read-only`。后台只检查更新，不会调用 Portainer 或自动重新部署。

## Portainer 部署

在 Portainer 的 `堆栈 -> 添加堆栈 -> 仓库` 中填写：

- 仓库 URL：`https://github.com/manjyunme-glitch/M-J-site.git`
- 仓库引用：`refs/heads/main`
- Compose 路径：`docker-compose.yml`
- 私有仓库认证：GitHub 用户名配合只授予该仓库 `Contents: Read-only` 的 fine-grained token。

在页面下方的环境变量区域填写：

```env
SITE_PASSWORD_HASH=$$2b$$...
ADMIN_PASSWORD_HASH=$$2b$$...
COOKIE_SECRET=至少64位随机字符串
SECURE_COOKIES=false
TRUST_PROXY=false
GITHUB_REPOSITORY=manjyunme-glitch/M-J-site
GITHUB_BRANCH=main
GITHUB_TOKEN=github_pat_xxx
```

两个密码值可在项目目录运行 `npm run hash-password -- <密码>` 生成。仓库拉取认证和 `GITHUB_TOKEN` 可以使用同一个只读 token。使用 HTTPS 反向代理后，将 `SECURE_COOKIES` 和 `TRUST_PROXY` 都改为 `true`。

Compose 默认把数据库绑定到 `/share/DockerData/M-J-site/data`，把上传文件绑定到 `/share/DockerData/M-J-site/uploads`。容器启动时会自动创建目录、修复权限，再以非 root 用户运行应用。本地开发如需使用项目目录，可覆盖为 `DATA_PATH=./data` 和 `UPLOAD_PATH=./uploads`。

如果旧版本已经使用 `m-j-site-data` 与 `m-j-site-uploads` 命名卷，先停止旧 Stack，并在 Docker 主机上迁移数据：

```sh
mkdir -p /share/DockerData/M-J-site/data /share/DockerData/M-J-site/uploads
docker run --rm -v m-j-site-data:/source:ro -v /share/DockerData/M-J-site/data:/target alpine sh -c 'cp -a /source/. /target/'
docker run --rm -v m-j-site-uploads:/source:ro -v /share/DockerData/M-J-site/uploads:/target alpine sh -c 'cp -a /source/. /target/'
```

确认文件已经复制后再重新部署；直接切换到空目录会得到一套新数据库。旧命名卷不会被 Compose 自动删除，可在确认新目录运行正常后自行备份或清理。Portainer 从 GitHub 拉取的临时构建目录由 Portainer 自身管理，Compose 只能固定应用的数据库和上传文件位置。

服务使用 Docker 主机现有的 `bridge` 网络，不再创建 Compose 独立网络，便于 Cloudflare Tunnel 通过 `192.168.0.113:1314` 访问。这个站点只有一个容器，不依赖 Compose 服务名解析。

GitHub 更新检查通过 `APP_HTTP_PROXY` / `APP_HTTPS_PROXY` 访问外网。`401` 表示请求已到达 GitHub，但 Token 无效或过期，不是代理故障；此时应在 Portainer 中重新生成并填写只授予本仓库 `Contents: Read-only` 的 fine-grained token。

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
