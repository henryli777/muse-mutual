# MUSE 异机备份

服务器的每日备份仍保存在 `/opt/muse-mutual/state/backups/`。另一个副本由
Henry 的 Mac 拉取，存于 `~/Library/Application Support/MUSE Backups/`，与服务器
和项目工作区分开。文件权限0600，目录0700，不自动删除旧副本。

Mac LaunchAgent `com.coinexo.muse.backup` 每天本地时间03:45运行，并在加载时执行。
Mac时区为Asia/Shanghai；睡眠错过的任务会在唤醒后运行。电脑须开机、登录且能通过
现有SSH密钥连接服务器。离线期间服务器自己的每日快照继续运行，Mac副本的更新
需要等待恢复连接。日志位于 `~/Library/Application Support/MUSE Backup/`。

执行程序安装到 `~/Library/Application Support/MUSE Backup/offsite-backup.mjs`，
使用现有Node.js22.13+。LaunchAgent仅保存SSH主机、已有密钥的文件路径和本地目的地，
不复制密钥内容，不传输运行时秘密，不向CI发布数据库。

## 手动运行与校验

```sh
MUSE_BACKUP_HOST=root@43.108.37.222 \
MUSE_BACKUP_KEY=/Users/henry/.ssh/id_ed25519_audit_43_deploy \
MUSE_BACKUP_DEST='/Users/henry/Library/Application Support/MUSE Backups' \
node scripts/offsite-backup.mjs
```

工具先在源站生成WAL一致快照，再读取该快照的SHA256。下载到私密临时目录后，
只有校验和一致、SQLite `quick_check`和外键校验通过、应用表存在的快照才进入
备份目录；传输失败或校验失败不留下被接受的副本。每个快照伴随0600权限的JSON
清单，包含来源、接收时间和SHA256。SSH严格校验已知主机，不绕过主机验证。

## 恢复演练与实际恢复

演练仅将本地备份复制到临时目录，用Node.js的`DatabaseSync`以只读方式执行
`PRAGMA quick_check`、`PRAGMA foreign_key_check`并读取邀请码记录，结束后删除
演练目录，不修改生产数据库。

实际恢复应停止MUSE容器，先保存现有数据库及WAL文件，再将选定且经SHA256校验的
快照恢复为 `/opt/muse-mutual/state/muse.sqlite`，设置1000:1000所有者与0600权限，
使用该发布目录的 `deploy-image.env` 和Compose重启。启动迁移只应用尚未执行的
迁移。恢复数据库会影响备份时间之后的修改，需要由运营者选择恢复时间点。

支持项目：<https://support.coinexo.top/>
