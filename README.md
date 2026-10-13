# MUSE 互助会

无需注册的 MUSE 邀请码分享网站。分享自己的邀请码和预计剩余次数，浏览最新分享，复制领取，反馈失效或错误；运营者可在维护入口核实反馈。

- 网站：<https://muse-mutual.blond-snail-7594.chatgpt.site>
- 公开源码：<https://github.com/henryli777/muse-mutual>
- [支持项目](https://support.coinexo.top/)

## 使用方式

1. 填写邀请码、当前预计剩余次数和可选昵称。次数默认 30，可填写 0–30 的整数；提交时间由服务器自动记录。
2. 在邀请码广场按最新分享或剩余次数浏览，也可筛选可领取、待核实、已用完等状态。
3. 点击「复制领取」，到 MUSE 使用邀请码。成功复制并经服务器确认后，本站预计余量扣减一次。
4. 遇到失效或错误时点击「反馈问题」。反馈先标记为「待核实」，由运营者决定是否停用或恢复。

**预计剩余次数并非 MUSE 官方兑换结果。** 它根据分享者填写的余量和本站确认的复制记录估算。网站无法观察 MUSE 实际使用、站外复制或手动选择文字复制，实际可用次数以 MUSE 为准；30 也不是经官方验证的总额度。

同一访客对同一码在 10 分钟内重复复制只扣一次。领取先预留 90 秒，剪贴板失败会取消预留；复制后网络中断时保存原操作并重试确认，避免重复扣减。预留过期后不再自动创建新的领取，页面会提示次数未同步。

分享者的修改凭据保存在本浏览器，凭据可用于调整自己记录的余量，不能清除社区反馈。清除站点数据、换设备或浏览器存储不可用可能导致无法继续自行修改，此时需要运营者维护。匿名访客 cookie 只用于轻量防重复与限流，不能代表真实身份。

## 技术与结构

使用 TypeScript、React、Vinext、Cloudflare Workers/D1 和 Drizzle 迁移。邀请码、预留、反馈与限流记录保存在服务器数据库；本浏览器仅保存提交管理凭据与待同步操作。首页适配手机和桌面，公开页面提供持续可见的「支持项目」入口。

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

`.dev.vars` 已被 Git 忽略，仅供本地使用。不要把真实值写入 `.env.example`、托管清单或客户端代码。生产环境通过 Sites 的秘密配置单独设置。

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

## 部署与持续集成

本项目使用 Sites 托管，`.openai/hosting.json` 声明现有 Site ID 和 D1 的 `DB` 绑定；`r2` 未启用。部署更新应保留现有 Site ID。

发布时先配置生产 `MUSE_SESSION_SECRET` 和 `MUSE_ADMIN_TOKEN` 为秘密值，确认公开访问模式，再按 Sites 的源码同步、打包、保存版本和部署流程执行。Sites 会在上传 Worker 前应用生产 D1 迁移。生产迁移与本地迁移相互独立，发布后需要验证匿名首页和 API 可访问。

Sites 源码远端由其官方 helper 管理，公开 GitHub 仓库使用独立的 `github` remote。不要把源码写入凭据、运行时数据或本地秘密推送到任何远端。该应用需要持久数据库和服务端 API，不能直接作为纯静态 GitHub Pages 网站运行。

GitHub Actions 在 Node.js 22、24 下执行锁定依赖安装、行为测试、类型检查与生产构建；CI 不需要生产秘密，也不修改生产数据库。

## 设计与许可

- [设计文档](docs/superpowers/specs/2026-10-13-muse-mutual-design.md)
- [实施计划](docs/superpowers/plans/2026-10-13-muse-mutual.md)
- [MIT 许可证](LICENSE)，Copyright © 2026 Henry Li。

[支持项目](https://support.coinexo.top/)
