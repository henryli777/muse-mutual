# MUSE 互助会 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付无需注册的公开 MUSE 邀请码分享网站，提供持久存储、可靠领取计数、失效反馈和维护审核。

**Architecture:** 使用 Sites Vinext 模板提供页面和同源 API，D1 保存邀请码、领取预留和反馈。业务仓储依赖注入 D1 接口，数据库迁移创建结构，客户端只保存本设备的提交管理凭据与待确认操作。GitHub 公开源码仓库和 Sites 源码远端分别管理，凭据不进入任何远端。

**Tech Stack:** Node.js >=22.13.0、TypeScript、React、Vinext、Cloudflare D1、Drizzle 迁移；Node 内置 test runner/SQLite 进行仓储测试，真实本地 Worker API 验证并发。

**Spec:** `docs/superpowers/specs/2026-10-13-muse-mutual-design.md`（用户已确认）。

## Global Constraints

- 网站名「MUSE 互助会」，项目目录/公开源码仓库名 `muse-mutual`。
- 公开浏览、录入和反馈无需注册；提交者凭私密管理凭据修改自己的余量；审核入口需管理员登录。
- 用户填写当前剩余整数，范围 0–30，默认 30；标明「预计剩余 N 次」，不伪称 MUSE 官方额度或成功兑换记录。
- 服务端生成 UTC 时间；客户端展示当地完整日期时间；最新分享以创建时间降序，复制/反馈不刷新创建时间。
- 复制成功并服务端确认才扣减；同访客同邀请码 10 分钟内重复领取不重复扣；预留失败或到期不消耗次数。
- 暖白/深绿、卡片网格、手机单列；数字、图标、文字共同表达状态。
- 反馈先待核实，单次反馈不永久下架；已核实失效与零余量停止领取。
- 所有公开页面和视图（含独立错误页）的「支持项目」均链接 `https://support.coinexo.top/`，桌面和手机滚动时导航入口仍可访问，首页保留头尾入口；管理界面与 API 不加入捐款 UI。不新建支付页面，不生成支付二维码。
- 不填充虚构邀请码、人数或兑换结果；生产数据库与本地测试数据分离。
- 使用 Sites 自带构建集成、DB 绑定和迁移；不在请求中建表，不上传 `.dev.vars`、`.sites-runtime/`、`.wrangler/` 或任何秘密。

## Review Focus

1. 最后一个名额遭并发请求、过期预留与确认交错：最多一份成功，余量不负，失败预留可以再次领取（Task 2）。
2. 浏览器剪贴板失去用户激活，或已复制但确认断网：不丢操作、不让用户重复扣减，明确提示并重试同步（Task 4）。
3. 分享者在有效预留期间下调余量：拒绝低于已预留数量的修改，管理员标记失效后未确认领取不能继续消耗（Tasks 1–3）。
4. 重复代码、纯空白、HTML 文本、非整数、过大请求：唯一约束、输入边界、React 文本转义、同源校验均生效（Tasks 1、3、4）。
5. 双标签页使用同一设备，或窃用他人的编辑凭据字段：共享访客 cookie、操作幂等；后端验证管理凭据，公开列表不泄露凭据或反馈原文（Tasks 1–4）。

## File Structure and Contracts

- `db/schema.ts`：Drizzle 表、约束和索引；邀请码含内部 `copyRevision`，领取持有预留时版本；`drizzle/*`：首次迁移及元数据。
- `lib/domain.ts`：DTO、输入验证、状态计算；`lib/server/identity.ts`：访客 cookie、凭据哈希、管理员会话。
- `lib/server/invite-repository.ts`：分享、列表、余量修改；`lib/server/claim-repository.ts`：预留/确认/取消；`lib/server/report-repository.ts`：反馈及审核。
- `lib/server/http.ts`：JSON 错误、同源检查、请求体上限；`lib/server/rate-limit.ts`：持久原子限流。
- `app/api/session/route.ts`、`app/api/invites/route.ts`、`app/api/invites/[id]/route.ts`、`app/api/claims/route.ts`、`app/api/claims/[operationId]/route.ts`、`app/api/reports/route.ts`、`app/api/admin/*/route.ts`：薄 HTTP 适配层。
- `app/page.tsx`、`app/layout.tsx`、`app/globals.css`、`components/invite-board.tsx`、`components/share-form.tsx`、`components/invite-card.tsx`、`components/report-dialog.tsx`、`app/admin/page.tsx`、`components/admin-console.tsx`：页面与交互。
- `lib/client/copy-invite.ts`：剪贴板与领取同步；`lib/client/api.ts`：类型化 API 调用。
- `tests/helpers/sqlite-d1.ts`、`tests/domain.test.ts`、`tests/invites.test.ts`、`tests/claims.test.ts`、`tests/reports.test.ts`、`tests/copy.test.ts`、`scripts/check-api.mjs`：行为测试与真实 Worker 验证。

统一公开 DTO：`InviteView = { id, code, nickname, remaining, available, copiedCount, createdAt, updatedAt, reviewStatus, reportCount, reportReasons }`。ID/code/nickname/日期为字符串，数量为整数，`reportReasons` 为原因枚举数组。日期输出为 UTC ISO8601；数据库有效期与判重使用 Unix 秒。`remaining` 为未确认消耗前余量；`available` 扣除尚有效预留。`reviewStatus` 为 `normal | pending | invalid`。私密 owner/visitor 哈希及反馈原文不得出现于公开 DTO。

统一错误：`{ error: { code, message } }`；400 输入错误，401 未登录，403 凭据/来源错误，404 不存在，409 重复/余量冲突，429 限流。请求体最大 8 KiB；邀请码 1–200 字符、昵称最多 40 字符、反馈说明最多 500 字符，只清除首尾空白，不假设官方编码格式。

### Task 1: Persistent sharing, visitor identity and ownership

**Files:** 初始化模板配置，修改 `db/schema.ts`、`.openai/hosting.json`（`d1: "DB"`, `r2: null`）；创建 domain、identity、http、rate-limit、invite repository、session/invites API 及对应测试。

**Interfaces:**
- `validateSubmission(input: unknown): { code: string; nickname: string; remaining: number }`。
- `createInvite(db: D1Database, input, ownerHash: string, now: number): Promise<InviteView>`。
- `listInvites(db, options: { sort: "latest" | "remaining"; filter: "available" | "pending" | "exhausted" | "all"; limit: number }): Promise<InviteView[]>`。
- `updateRemaining(db, id: string, ownerHash: string, remaining: number, now: number): Promise<InviteView>`；不得清除反馈状态。
- `getVisitor(request): { id: string; hash: string; setCookie?: string }`；cookie 用服务端秘密签名，生产 Secure/HttpOnly/SameSite=Lax。
- API：GET `/api/session` 初始化访客；GET `/api/invites` 列表；POST 分享返回 `{invite, ownerToken}`；PATCH `/api/invites/:id` 用请求头 `X-Owner-Token` 修改，不放 URL。

- [x] **Step 1: 建立隔离开发分支/工作区，复制 Sites Vinext 模板，注册一次 Site 并立即原子保存真实 project_id，启动唯一依赖安装。** 保留现有设计与计划文档；凭据仅会话内存/隐藏 stdin；正式实现等待依赖就绪。
- [x] **Step 2: 写失败测试。** `submission_boundaries`：默认 30，0/30 合法，-1/31/1.5/空白拒绝；`duplicate_code_keeps_original`：去首尾空白判重且大小写保留；`latest_uses_creation_time`：编辑不抬高排序；`owner_cannot_edit_other_record`：他人 token 返回403；`owner_cannot_undercut_reservations`：余量不能设为小于有效预留数；`public_dto_has_no_secrets`：没有哈希/ownerToken/反馈原文。
- [x] **Step 3: 运行 `node --experimental-strip-types --test tests/domain.test.ts tests/invites.test.ts`，确认失败来自缺失行为；实现迁移、仓储、cookie 与 API。** SQLite 测试适配器执行真实迁移与 prepare/batch SQL，batch 具有事务和回滚语义。限流使用数据库窗口计数：分享每访客每小时10次、领取每访客每分钟30次、反馈每访客每小时20次、管理员登录每来源每15分钟5次；过限返回429与 Retry-After。
- [x] **Step 4: 同命令验证全部通过，`npm run db:generate` 生成并检查迁移，`npx tsc --noEmit` 验证类型。** 索引覆盖邀请码唯一值、创建时间、预留有效期、访客/码/领取时间、反馈唯一值和限流窗口。
- [x] **Step 5: 仅提交本任务源码、迁移和测试，`git diff --cached --check` 后提交。**

### Task 2: Atomic reservation and exactly-once confirmation

**Files:** claim repository、claims API、`tests/claims.test.ts`；必要的 schema 变化追加迁移。

**Interfaces:**
- `reserveClaim(db, { inviteId: string; operationId: string; visitorHash: string }): Promise<{ operationId: string; code: string; expiresAt: number; alreadyCounted: boolean }>`；预留有效期90秒。
- `confirmClaim(db, operationId: string, visitorHash: string): Promise<{ invite: InviteView; counted: boolean }>`。
- `cancelClaim(db, operationId: string, visitorHash: string): Promise<void>`；取消确认过的操作不退款。
- POST `/api/claims` 预留；PATCH `/api/claims/:operationId` body `{action: "confirm" | "cancel"}`；操作 ID 由浏览器 `crypto.randomUUID()` 生成，同一次领取重试保持不变。

- [x] **Step 1: 写失败测试。** `last_slot_has_one_winner`：20个访客抢余量1最多一个有效预留；`confirm_once`：确认10次只减1；`failed_copy_cancel_does_not_consume`：取消后余量原值；`expired_claim_releases_capacity`：90秒后另一个可领取且旧确认409；`same_visitor_ten_minutes_no_second_debit`：同cookie不同操作 ID不再扣；`foreign_visitor_cannot_confirm`：403；`invalidate_during_reservation_blocks_confirmation`：409且不扣；`cross_tab_duplicate_does_not_hold_two_slots`：同设备并发不多占名额。
- [x] **Step 2: 运行 `node --experimental-strip-types --test tests/claims.test.ts`，确认失败后实现仓储。** 预留通过条件 `INSERT ... SELECT` 原子检查：记录未失效、未存在本设备有效预留/近期确认、`remaining > count(active reservations)`。有效预留不改变 remaining。有效性判断使用 SQL `unixepoch('now')`，不能用请求开始时保存的旧时间；测试适配器可控制数据库时间。每个 `prepare()` 只有一条 SQL，禁止跨多个请求裸 SELECT 再 UPDATE。
- [x] **Step 3: 实现三语句原子确认及持久幂等记录。** 同一个 D1 `batch()`：①将匹配访客/操作/邀请码及copyRevision、仍有效且记录未失效的 reserved 操作改为暂态 confirming；②仅当这个操作为 confirming 时，邀请码 remaining 减1、copiedCount加1；③将这个操作 confirming 改为confirmed并记录数据库时间。整批失败全部回滚，事务外永不暴露confirming，重试不能再次消耗；CHECK 防止负余量。操作ID永久绑定原访客、邀请码及预留版本，重试不刷新到期时间；取消/过期操作不能重新确认。重复领取返回该访客原有近期确认操作；全局唯一邀请码不能通过重复建行绕过10分钟判重。有效预留只统计版本仍匹配的记录；更新余量时原子拒绝小于有效预留数量的输入。
- [x] **Step 4: 运行全部 domain/invite/claim 测试，构建 Worker并应用未执行的本地迁移。** `scripts/check-api.mjs` 使用真实本地 Worker 创建独立测试邀请码并发领取验证最后一席；仅在本地测试库运行，测试记录使用明显前缀。
- [x] **Step 5: 检查差异并提交，记录实际测试结果。**

### Task 3: Community reports and protected moderation

**Files:** report repository、reports API、admin session/reports/invites API、admin 页面、`tests/reports.test.ts`、`.env.example`。

**Interfaces:**
- `submitReport(db, { inviteId: string; visitorHash: string; reason: "expired" | "incorrect" | "other"; note: string }, now: number): Promise<InviteView>`。
- `reviewInvite(db, id: string, action: "invalidate" | "restore", now: number): Promise<InviteView>`；invalidate 增加内部copyRevision，让旧预留即使在恢复后也不能复活；restore 解决既有反馈，不清零 copiedCount 或改创建时间。
- POST `/api/reports` 返回最新公开 DTO；POST `/api/admin/session` 登录、DELETE退出；GET `/api/admin/reports` 返回需认证的原始说明；PATCH `/api/admin/invites/:id` `{action}`。
- 管理员秘密 `MUSE_ADMIN_TOKEN`、cookie 签名秘密 `MUSE_SESSION_SECRET` 由秘密配置提供；登录后短期8小时HttpOnly会话。保留 Sites 认证集成，不新增 OAuth。

- [x] **Step 1: 写失败测试。** `single_report_only_pending`：一次反馈不关闭领取；`repeat_report_no_inflation`：同设备同码仅一条；`private_notes_not_public`：公开列表仅原因与数量；`anonymous_moderation_rejected`：401；`owner_cannot_clear_reports`：仍pending；`restore_preserves_counts`：恢复不改变余量和创建时间；`wrong_origin_rejected`：403；`body_too_large_rejected`：413。
- [x] **Step 2: 运行 `node --experimental-strip-types --test tests/reports.test.ts`，确认失败后实现投诉及审核。** 原文仅管理员能查看；管理员会话秘密缺失时审核入口关闭并给出配置提示；错误响应不泄露数据库或秘密。
- [x] **Step 3: 构建简洁审核页面。** 登录、待核实列表、反馈原文、标记失效/恢复、退出；管理员页面不加入捐款 UI。
- [x] **Step 4: 运行全部仓储和权限测试、`npx tsc --noEmit`；检查未经授权和跨来源请求都失败。**
- [x] **Step 5: 提交源码和 key 名称示例，不提交真实值。**

### Task 4: Responsive sharing board and resilient clipboard flow

**Files:** 首页、布局、CSS、表单/卡片/反馈组件、client API、copy coordinator、`tests/copy.test.ts`、favicon。

**Interfaces:** `copyInvite({ inviteId, api, clipboard, storage, now }): Promise<{ status: "confirmed" | "pending" | "cancelled" | "needs_click"; invite?: InviteView }>`；依赖可注入测试，状态变更驱动卡片按钮与 live region。API 使用前述 DTO，不在客户端推断服务端最终余量。

- [x] **Step 1: 写失败的交互协调器测试。** `clipboard_failure_cancels`：失败发取消且没有确认；`confirmation_network_failure_stays_pending`：剪贴板成功后断网保存操作ID、提示同步中，重试同ID；`two_tabs_same_cookie`：与后端近期判重一致；`expired_pending_does_not_retry_new_claim`：旧预留过期给出明确提示，不自动再次领取。
- [x] **Step 2: 运行 `node --experimental-strip-types --test tests/copy.test.ts`，确认失败后实现复制流程。** 支持 ClipboardItem 的浏览器在原始点击同步发起带 Promise<Blob> 的剪贴板写入，内容等待服务端预留；需要再次激活的浏览器改为明确第二次点击「名额已预留，点击复制」。失败取消，确认断网保存并重试；兼容能力不足时显示具体操作提示。若剪贴板已成功但断网直至预留过期，提示「已复制，预留已过期，次数未同步，请以 MUSE 实际使用结果为准」，不自动创建新领取或复活旧预留。网站无法由服务端证明系统剪贴板操作成功，这仍是本站确认记录估算。
- [x] **Step 3: 实现完整首页。** 顶部标题、表单默认30、最新/剩余排序与过滤、空状态、刷新/错误状态、完整日期、余量及审核标识、使用说明、头尾支持链接。时间在客户端本地化，避免服务器时区及 hydration 差异。记录本设备 ownerToken 以提供「修改余量」，本地凭据丢失时说明只能由运营者维护。
- [x] **Step 4: 在本地预览验证桌面与手机。** 两个浏览器环境共享提交与扣减；表单、筛选、复制成功与失败、反馈、修改余量、审核、零次数禁用；昵称/反馈包含 HTML 时作为文字展示；键盘焦点、弹窗关闭、live region 与窄屏无溢出。
- [x] **Step 5: 运行全部行为测试、类型检查和生产构建，提交已验证前端。** 不为纯配色和间距编写实现镜像测试。

### Task 5: Release, public source and production verification

**Files:** README、LICENSE（MIT）、`.gitignore`、`.github/workflows/ci.yml`、`.openai/hosting.json`；工作区项目索引。

**Interfaces:** 使用注册得到且已持久化的 Sites project_id；同一个 Site 不重复创建。GitHub 远端命名 `github`，Sites 源码远端由官方 helper 管理，避免覆盖或混用凭据。

- [x] **Step 1: 完成独立审查，修复影响需求、安全、并发或浏览器可用性的发现。** 审查聚焦 Review Focus，不反复重跑已证明且输入未变的检查。
- [x] **Step 2: 完成中文 README、MIT许可证及 CI。** README 描述估算次数、重复复制规则、本设备修改限制、反馈机制、开发/测试/迁移/管理员配置和实际公开 URL；CI 用 Node22/24运行行为测试、类型检查及构建，不含秘密。实际公开地址已验证。
- [x] **Step 3: 最终验证。** `npm test` 对应所有Node行为测试；`npx tsc --noEmit`；Sites build helper；本地真实 Worker 并发/API检查；桌面/手机浏览器检查。确认生产迁移只含schema，不含测试数据；`git diff --check`，检查追踪文件排除真实凭据及运行时数据。
- [x] **Step 4: 创建并推送 `henryli777/muse-mutual` 公开GitHub仓库。** 若该名字已存在先检查其身份与源码，不覆盖不相关项目。推送最终源码，更新工作区项目索引。
- [x] **Step 5: 使用 Sites helper 通过隐藏 stdin 传入会话凭据，推送匹配源码并打包。** 配置运行时秘密，按用户明确请求把访问模式设为public；如账户未提供public能力则报告限制，不把私有站声称为公开。
- [x] **Step 6: 保存对应源码版本并部署该版本，等待终态，保留真实 URL。** 公开站使用 `save_site_version` 后 `deploy_site_version`；不重复保存已成功版本。
- [x] **Step 7: 验证匿名访问首页成功，生产真实空状态、不写入测试记录；打开实际网站，交付公开网站和GitHub链接。** 若托管或匿名浏览验证失败，给出实际完成部分和可恢复阻塞，不声称公开发布成功。

## Plan Self-review and Execution Handoff

已逐项覆盖已确认设计：共享持久化、提交和更新时间、默认与边界、并发/幂等/过期、投诉与审核、所有者维护、前端及移动端、支持链接、公开源码与公开部署。五项 Review Focus 均有对应行为验证；接口与 DTO 命名在任务间保持一致。

执行建议：**Native（由主代理直接实施，各阶段按计划验证，结束时独立审查）**。仓储和接口关联较紧，统一实施可减少交接；独立代理用于协议/审查等不共享编辑状态的任务。

当前状态：五项任务已完成。独立审查发现已修复，36 项行为测试、类型检查、生产构建和 Node 22/24 CI 通过；公开网站与 GitHub 仓库已发布，匿名首页/API/错误页验证通过。

发布网站：https://muse-mutual.blond-snail-7594.chatgpt.site

公开源码：https://github.com/henryli777/muse-mutual
