# Windows 桌面验收（2026-11-09）

版本：Everse 0.1.0 Alpha，Electron 45.2.3，随包 Node 24.20.0。环境：Windows x64，系统 build 26200。安装器为 NSIS 当前用户安装；测试安装在独立的 `D:\酒馆\Everse-desktop-acceptance`，数据使用每次新建的临时用户资料目录，未读取或覆盖实际用户存档。

| 项目 | 结果 | 依据 |
|---|---|---|
| 类型、回归、构建 | 通过 | `npm run check`、`npm test`：81/81；Vite 和桌面构建成功 |
| 实际安装 | 通过 | Setup.exe 静默安装退出码 0，安装目录中 EXE 可独立启动 |
| 不依赖 Vite / 全局 Node | 通过（隔离条件） | `scripts/smoke-desktop.mjs` 仅保留 Windows 系统 PATH，运行安装后的 EXE；页面 `everse://app/`，后端使用包内 node.exe，不访问 5173/5180 |
| API 配置与生成 | 通过（假供应商） | 在真实界面填写测试 Key，Windows DPAPI 保存，发送真实本地 HTTP/SSE 请求；两轮请求，零付费调用 |
| 保存、关闭、重开续玩 | 通过 | 重开后连接 hasKey、模块、最近存档和选中模型保留，第二轮生成成功，存档有四条消息；DB 无测试 Key 明文 |
| 覆盖安装与数据分离 | 通过 | 同目录重新安装退出 0；隔离用户数据库文件 SHA-256 不变 |
| 后端私有边界与关闭 | 通过 | desktop-boundary.test.ts：动态端口、无令牌/错误来源 403、不暴露源码和数据库、父 IPC 断开后端退出 |
| 新建取消 | 通过 | 填写后取消，创建前后 sessions 均为空；确认失败事务不留空存档 |
| 世界删除 | 通过 | 界面取消保留存档；服务测试确认范围、整体回滚、只删除所选分组存档、共享资源保留 |
| 预设 / Mod | 通过 | 管理 API、重启、关闭不发送、实际前后置与预算；桌面界面创建启用、导出 JSON 再导入，导入默认关闭；桌面/窄屏截图 |
| 源码模式 | 通过 | `npm run test:install`：静态资源、假 API、保存恢复、同源检查与私有文件隔离 |
| 真正干净 Windows VM | 未测试 | 本机没有 Windows Sandbox；收窄 PATH 和新资料目录不等于无开发工具的干净系统。步骤见 DESKTOP.md |
| 真实付费模型 / Windows 10 / ARM64 | 未测试 | 无真实模型调用；当前安装包仅 x64，本机不是 Windows 10 |
| 签名与 SmartScreen 信誉 | 未完成 | 未配置代码签名证书，未绕过系统安全设置 |

产物：`release/Everse-0.1.0-Windows-x64-Setup.exe`、`release/SHA256SUMS.txt`。截图位于 `release/qa/desktop-*.png`。文件不提交到源码 Git；可用 Windows desktop package 工作流生成可下载构建产物。

主要命令：`npm run pack:win`；`node scripts/smoke-desktop.mjs <安装目录/Everse.exe>`。测试仅以 Electron 主进程替换原生保存对话框的文件选择，实际文件导出与再导入仍走应用接口；没有替换后端、存档服务或模型调用适配器。

结论：已得到能直接安装和独立运行的 Windows Alpha 包；不能称为已在干净 Windows 全面验收的正式稳定版。发布前剩余关键检查为干净机器安装、供应商实际连接和代码签名。
