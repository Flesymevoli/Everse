# 安装、更新和排错

## Windows 一键使用

下载 GitHub 源码 ZIP 并解压，双击 `start.cmd`，或在项目根目录运行 `./start.cmd`。不要在 ZIP 预览里运行，不需要 Git 即可使用下载的源码。

脚本使用 Windows 自带 PowerShell，通过 `-Command` 执行可读的下载/校验步骤；不会设置 ExecutionPolicy。Node.js 24.20.0 ZIP 来自 https://nodejs.org/dist/v24.20.0/ ，SHA-256 固定在 start.cmd，并已与官方 SHASUMS256.txt 核对。仅下载校验后执行；不忽略 TLS/证书错误，不修改安全设置。

- `.runtime/`：私有 Node 与安装状态，可重建，不是存档。
- `node_modules/`、`dist/`：锁文件安装与构建结果。
- `data/`：用户资料、原文、存档、加密 Key；不要删除。
- 没有全局安装、PATH 持久修改或管理员操作。首次需要访问 nodejs.org 和 npm 注册表。

AI/无人值守参数：`start.cmd --setup-only` 仅安装；`start.cmd --no-browser` 启动而不打开浏览器。自动化可对子进程设置 `YUNO_NO_PAUSE=1`，失败直接退出而不等待按键。正常启动后保留窗口；Ctrl+C 停止。

## 已有 Node.js

Node.js 24.20+，在根目录 `npm run setup` 然后 `npm start`。setup 安装开发构建依赖并构建，重复执行会根据锁文件与源码指纹跳过已完成步骤。npm start 不自动安装；dist 缺失时明确报错。

`npm run dev` 仅供开发。不要与普通启动同时占用 5173。

## 端口与数据目录

默认单服务监听 127.0.0.1:5173。只对子进程配置示例：

```powershell
$env:EVERSE_PORT='5174'
$env:EVERSE_DATA_DIR='D:\EverseData'
.\start.cmd
```

不设置即沿用原 data/game.sqlite。端口被占用不会自动停止任何进程。API/静态页同源，只公开编译资源；源文件与数据库不作为静态文件提供。不要配置反向代理到公网。

## 更新和卸载

停止应用，备份整个 data 目录。Git 用户在工作区无修改时 `git pull --ff-only`，再运行 start.cmd；若有本地修改先处理冲突，不 reset/强推。ZIP 用户解压到新目录，应用停止时复制备份的 data 目录，然后启动；不要覆盖正在运行的数据库。跨 Windows 用户的 DPAPI Key 不能保证可解密，请重新填写。

卸载只需停止应用并删除安装目录，但先自行备份 data。脚本没有系统级安装或注册表项。

## 常见问题

- 官方下载或 npm 失败：查看错误，检查网络和磁盘空间后重试；不跳过哈希或换来历不明的包。
- 解压中断：关闭安装窗口，检查 .runtime 中是否存在不完整的对应 Node 版本目录；备份后只移除该运行时目录再试，保留 data。
- 端口占用：关闭此前启动窗口，或使用新的 EVERSE_PORT。
- 未配置模型：先在设置中保存 API 连接，再在主界面选择。应用不再提供模拟模型选项；自动化测试仍使用隔离的假 API。
- 非 Windows：Node 命令可以尝试，但未验收；Windows DPAPI 保存 Key 不可用，临时 Key 不降级为明文保存。

旧名为 YunoTavern / Narrative Slice。改名不迁移或删除现有数据：保留 data/game.sqlite、narrative.connections.v1 浏览器键、旧世界书格式与 DPAPI 加密标识。原 YUNO_PORT/YUNO_DATA_DIR 仍兼容，新的 EVERSE_PORT/EVERSE_DATA_DIR 优先。
