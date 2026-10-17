# MUSE 互助会

无需注册的 MUSE 邀请码分享网站。分享自己的邀请码和预计剩余次数，浏览最新分享，复制领取，反馈失效或错误；运营者可在维护入口核实反馈。

- 正式域名：<https://muse.coinexo.top>
- 原 Sites 地址：<https://muse-mutual.blond-snail-7594.chatgpt.site>（切换完成后跳转至正式域名）
- 公开源码：<https://github.com/henryli777/muse-mutual>
- [支持项目](https://support.coinexo.top/)

## 使用方式

1. 填写邀请码、当前预计剩余次数和可选昵称。次数默认 30，可填写 0–30 的整数；提交时间由服务器自动记录。
2. 在邀请码广场按最新分享或剩余次数浏览，也可筛选可领取、待核实、已用完等状态。
3. 点击「复制领取」，到 MUSE 使用邀请码。成功复制并经服务器确认后，本站预计余量扣减一次。
4. 在 MUSE 使用后，可在本次领取的七天内反馈「使用成功」或「未能使用」。成功反馈展示使用者提供的最近验证时间；失败反馈先标记为「待核实」，由运营者决定是否停用或恢复。反馈不会再次扣减次数。
5. 「你最近领取的」保留最多20条本浏览器的近期领取记录；已用完或不在当前分类中的记录仍可反馈。重复提交同一领取的同一结果只记录一次，结果确认后不能更换。

**预计剩余次数并非 MUSE 官方兑换结果。** 它根据分享者填写的余量和本站确认的复制记录估算。网站无法观察 MUSE 实际使用、站外复制或手动选择文字复制，实际可用次数以 MUSE 为准；30 也不是经官方验证的总额度。

同一访客对同一码在 10 分钟内重复复制只扣一次。领取先预留 90 秒，剪贴板失败会取消预留；复制后网络中断时保存原操作并重试确认，避免重复扣减。预留过期后不再自动创建新的领取，页面会提示次数未同步。

分享者的修改凭据保存在本浏览器，凭据可用于调整自己记录的余量，不能清除社区反馈。清除站点数据、换设备或浏览器存储不可用可能导致无法继续自行修改，此时需要运营者维护。匿名访客 cookie 只用于轻量防重复与限流，不能代表真实身份。

## 技术与结构

使用 TypeScript、React、Vinext 和 Drizzle 迁移。正式部署运行在 Node.js + 持久 SQLite，保留 Cloudflare Workers/D1 构建选项。邀请码、预留、反馈与限流记录保存在服务器数据库；本浏览器保存提交管理凭据、待同步操作及近期领取的反馈状态。首页适配手机和桌面，公开页面提供持续可见的「支持项目」入口。

- `app/`：页面和同源 API；`app/admin/` 为维护入口。
- `components/`：分享表单、邀请码卡片、反馈弹窗与维护界面。
- `lib/server/`：数据库仓储、签名会话、来源校验与限流。
- `lib/client/`：剪贴板协调与本地凭据保存。
- `db/schema.ts`、`drizzle/`：数据库结构及迁移。
- `tests/`：基于真实迁移和 SQLite 的仓储、权限与复制流程测试。

## 本地开发

需要 Node.js **22.13.0 或更高版本**和 npm；CI 覆盖 Node.js 22、24。

```sh
git clone https://github.com/henryli777/muse-mutual.git
cd muse-mutual
npm run install:ci
cp .env.example .dev.vars
```

在 `.dev.vars` 中分别填写两个独立、随机且足够长的秘密值；建议各使用至少 32 字节随机值：

| 配置项 | 用途 |
| --- | --- |
| `MUSE_SESSION_SECRET` | 签名匿名访客和管理员会话；缺失时业务 API 不提供服务。 |
| `MUSE_ADMIN_TOKEN` | 维护入口登录凭据；缺失时无法登录审核。 |

`.dev.vars` 已被 Git 忽略，仅供本地使用。不要把真实值写入 `.env.example`、托管清单或客户端代码。正式服务器通过 `/opt/muse-mutual/secrets.env` 注入秘密；Sites 构建使用其独立的秘密配置。

新克隆需要先构建并初始化本地数据库：

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_kind_grandmaster.sql
npm run dev
```

开发服务默认使用 <http://localhost:5173>。也可以在构建后执行 `npm run start`，通过 Wrangler 预览构建产物。本地 D1 数据位于忽略的 `.wrangler/state`，与生产数据库分离；**不要重复执行已经应用过的迁移**。

## 测试与数据库变更

```sh
npm test
npm run typecheck
npm run build
```

行为测试覆盖最后一个名额的并发预留、确认幂等、过期释放、短时重复复制、所有者权限、反馈隐私和剪贴板失败/断网恢复。

本地服务启动且管理员秘密已配置后，可验证真实 Worker API：

```sh
node scripts/check-api.mjs http://127.0.0.1:5173
```

该脚本仅接受 localhost/127.0.0.1，向本地数据库写入带 `LOCAL-TEST-` 前缀的测试记录，验证 20 个访客竞争最后一个名额以及重复确认、所有者权限与审核。不要把这些测试记录作为生产数据发布。

修改 `db/schema.ts` 后运行 `npm run db:generate`，检查新 SQL、快照和 journal 并一同提交。按顺序将尚未执行的新迁移应用到本地数据库，命令中的 `--file` 改为对应文件。已应用的迁移不改写、不重放；迁移只包含结构变更，不写入邀请码示例或测试数据。

## 维护入口

访问网站的 `/admin`，使用 `MUSE_ADMIN_TOKEN` 登录。管理员会话有效期为 8 小时，可查看反馈原文、标记失效、恢复记录和退出登录。公开列表只显示反馈类别与数量，不公开补充说明。

一次反馈不会直接永久下架；已核实失效或余量为零时停止领取。恢复记录保留余量、本站领取次数和原提交时间。维护入口不展示捐款界面。

邀请码支持持久化置顶：`invites.pinned` 为 1 的记录在两种排序下都优先显示，卡片显示“置顶”，筛选和可领取状态仍按实际余量与审核结果计算。当前由服务器运营者按记录 ID 和邀请码精确设置该字段（0 取消、1 置顶），公开提交无法设置；置顶不修改录入时间、余量或领取记录。

## 同服务器部署与持续集成

正式域名为 `muse.coinexo.top`，DNS A 记录源站为 `43.108.37.222`。使用现有服务器的 Nginx + Docker，容器仅监听服务器回环端口 `127.0.0.1:4326`，Nginx 提供 HTTPS。部署文件见 `deploy/self-hosted/`。

- 应用版本：`/opt/muse-mutual/releases/<release>`，当前版本链接 `/opt/muse-mutual/current`。
- 生产数据库：`/opt/muse-mutual/state/muse.sqlite`，WAL 持久卷在版本切换和重启后保留。
- 私密配置：`/opt/muse-mutual/secrets.env`，仅包含运行时秘密，不打入镜像。管理员凭据与原站相同。
- 数据库启动迁移：只执行未应用的结构迁移，记录校验和并拒绝改写已应用迁移。
- 备份：`deploy/self-hosted/backup.sh` 使用 SQLite 一致快照并校验完整性，保存至持久卷的 `backups/`。`muse-backup.timer` 每天北京时间约03:15运行（随机延迟最多15分钟）；不会自动删除旧备份。
- 异机备份：`scripts/offsite-backup.mjs` 通过既有SSH连接拉取新的完整快照，校验SHA256及SQLite完整性后私密保存。当前目的地是 Henry 的 Mac，每天北京时间03:45拉取，睡眠错过时会在唤醒后运行；Mac须在线并能连接服务器。配置、恢复步骤见[异机备份说明](docs/offsite-backup.md)。

正式升级使用 CI 预构建镜像，服务器只执行校验、载入和健康检查，不安装依赖或编译。GitHub Actions 的 Node.js 22、24 验证全部通过后，主分支才构建一次 `linux/amd64` 镜像；artifact 名称为 `muse-linux-amd64-<完整提交SHA>`，保留14天，包含压缩镜像、精确源码、SHA-256校验值、镜像ID和OCI版本标识。下载使用现有 GitHub CLI 登录，不需要把 GitHub 凭据或生产秘密传到服务器。

在已登录 `gh` 的本地电脑选定一次成功的主分支运行并下载：

```sh
release_run=123456789 # 替换为成功的 CI 运行ID
release_revision=$(gh run view "$release_run" --repo henryli777/muse-mutual --json headSha --jq .headSha)
release_bundle="outputs/release-$release_revision"
gh run download "$release_run" --repo henryli777/muse-mutual --name "muse-linux-amd64-$release_revision" --dir "$release_bundle"
cd "$release_bundle"
printf '%s  %s\n' "$(cat release-source.tar.gz.sha256)" release-source.tar.gz | sha256sum -c -
printf '%s  %s\n' "$(cat image.tar.gz.sha256)" image.tar.gz | sha256sum -c -
```

把经过校验的包传至服务器的新版本目录，将 `release-source.tar.gz` 解压在该目录根部，保留镜像和各校验/版本文件。确认 `/opt/muse-mutual/current` 仍指向健康的现有版本，并先创建数据库备份。随后在服务器执行：

```sh
cd /opt/muse-mutual/releases/<release>
bash deploy/self-hosted/deploy-image.sh "$PWD" <完整提交SHA>
curl -fsS https://muse.coinexo.top/api/invites?filter=all
```

部署脚本使用排他锁，拒绝损坏归档、错误提交/平台或不匹配的镜像ID。经典 Docker 使用配置摘要，启用 containerd 的 Docker 使用清单摘要；CI 从镜像归档中核对引用、清单和配置之间的摘要关系，提供对应的 `image-manifest-id.txt`，部署只接受已核对的摘要。Compose使用本机校验后的不可变镜像ID，并显式禁用构建和拉取；健康检查成功后才原子切换 `current`。失败时恢复此前容器的确切镜像，数据库和WAL保持原位；前一版本和镜像ID记录在新版本的 `previous-release.txt`、`previous-image-id.txt`。`deploy-image.env` 记录已接受的镜像，日常重启使用：

```sh
cd /opt/muse-mutual/current
docker compose --env-file deploy-image.env -f deploy/self-hosted/compose.yaml up -d --no-build --pull never --wait
```

若镜像已成功载入、部署在切换容器前中断，可以用 `MUSE_SKIP_IMAGE_LOAD=1` 重新运行部署脚本，避免再次载入大镜像。此选项仍执行归档校验、镜像摘要、版本、平台和健康检查；仅限复用这次已验证的镜像。

首次配置使用 `nginx-http.conf`，执行 `nginx -t` 后重载；通过 `/var/www/letsencrypt` 签发证书，再使用 `nginx-https.conf`。普通HTTP请求重定向至HTTPS，ACME路径保持可达。Cloudflare代理可使用 Full (strict)；不要使用 Flexible。既有Certbot定时器负责续期。

已接受版本需要人工回滚时，先核对前一镜像仍在本机、数据库变更与旧应用兼容，再将 `MUSE_IMAGE` 设为记录的前一镜像ID，用同一Compose配置执行 `up -d --no-build --pull never --wait`，成功后切回记录的前一版本目录。发布迁移应保持向后兼容；镜像回滚不会撤销已执行的迁移。恢复数据库时先停止MUSE容器，备份当前数据库及WAL文件，再恢复经校验的备份，设置1000:1000、0600权限后重新启动。不要将本地测试数据库上传至生产，也不要在确认回滚窗口结束前清理旧镜像。

本地验证自托管构建：

```sh
npm run build:selfhost
MUSE_DB_PATH=/absolute/path/to/local/muse.sqlite node --env-file=.dev.vars scripts/self-hosted.mjs start --port 5177 --hostname 127.0.0.1
```

### 保留的 Sites 构建

Cloudflare 版本使用 Sites 托管，`.openai/hosting.json` 声明现有 Site ID 和 D1 的 `DB` 绑定；`r2` 未启用。部署更新应保留现有 Site ID。

发布时先配置生产 `MUSE_SESSION_SECRET` 和 `MUSE_ADMIN_TOKEN` 为秘密值，确认公开访问模式，再按 Sites 的源码同步、打包、保存版本和部署流程执行。Sites 会在上传 Worker 前应用生产 D1 迁移。生产迁移与本地迁移相互独立，发布后需要验证匿名首页和 API 可访问。

Sites 源码远端由其官方 helper 管理，公开 GitHub 仓库使用独立的 `github` remote。不要把源码写入凭据、运行时数据或本地秘密推送到任何远端。该应用需要持久数据库和服务端 API，不能直接作为纯静态 GitHub Pages 网站运行。

GitHub Actions 在 Node.js 22、24 下执行锁定依赖安装、行为测试、镜像部署校验/回滚测试、类型检查，以及Worker和自托管两种生产构建；验证通过的主分支额外生成可部署镜像artifact。CI 不需要生产秘密，也不修改生产数据库。

## 设计与许可

- [设计文档](docs/superpowers/specs/2026-10-13-muse-mutual-design.md)
- [实施计划](docs/superpowers/plans/2026-10-13-muse-mutual.md)
- [MIT 许可证](LICENSE)，Copyright © 2026 Henry Li。

[支持项目](https://support.coinexo.top/)
