# Windows 桌面包

普通玩家运行 `Everse-0.1.0-Windows-x64-Setup.exe`，安装后从桌面或开始菜单打开 Everse。无需 Node、npm、终端、Vite 或浏览器开发预览；只有主动调用模型才需要供应商网络。当前包支持 Windows x64；未签名，不宣称通过 SmartScreen 信誉或杀毒兼容认证，不建议关闭系统安全设置。

## 数据与更新

- 数据库及 Windows DPAPI 加密的 API Key：`%APPDATA%\Everse\data\game.sqlite`。角色卡、世界书、预设、提示词模块、文档及存档均在库中。
- 窗口偏好、最近存档及所选模型：`%APPDATA%\Everse` 下的 Electron 用户资料；临时 Key 不保存。
- 菜单 Everse → 打开用户数据目录。备份前完全退出应用，复制整个 data 目录。更新安装目录不会删除此目录，卸载默认也保留。
- 源码版仍使用原 `data/`，不自动搬迁、合并或覆盖。需要迁移时，两端完全退出后，用户备份并将整个旧 data 复制到桌面 data；目标已有数据时不能覆盖。跨 Windows 账号/机器需重填 Key。
- `EVERSE_DESKTOP_DATA_ROOT` 仅是独立用户资料路径覆盖（测试或高级使用）；默认玩家无需配置。桌面版不继承源码版 EVERSE_PORT / EVERSE_DATA_DIR。

## 实现边界

Electron 45.2.3 提供隔离窗口；后端仍是原 Hono + SQLite 引擎，用包内经官方 SHA-256 校验的 Node 24.20.0 运行。前端为 Vite **构建产物**，运行时无 Vite。没有重写 Agent Runtime。

`everse://app` 是稳定的内部页面来源，保证后端随机端口变化不丢偏好。主进程转发到仅监听 127.0.0.1 的随机端口，通过每次启动的私有随机令牌访问；浏览器端拿不到令牌。限制导航、关闭 Node integration、启用 sandbox/contextIsolation、CSP，只允许自有页面请求本地服务。

后端就绪才打开页面；单实例避免两个桌面程序同时管理同一资料。窗口退出发送停止消息；父进程崩溃/断开后端也会退出。启动失败明确报告数据位置，不自动删除数据库。已提交的存档事务不依赖窗口是否继续打开。

## 维护者构建与测试

Windows x64，Node 24.20+：

```powershell
npm ci
node --use-env-proxy node_modules/electron/install.js
npm run pack:win
npm run test:desktop
```

输出 `release/Everse-0.1.0-Windows-x64-Setup.exe`；`.desktop/` 是只包含构建产物的临时目录，不包含用户数据。`scripts/build-desktop.mjs` 校验官方 Node ZIP 并仅提取 node.exe/LICENSE，打包时不携带 npm。前后端依赖许可证一并分发。

`test:desktop` 使用真实打包 EXE、全新临时用户目录、仅 Windows 系统目录的 PATH、本地假 Chat Completions 服务和真实 Windows DPAPI，验证新建取消、模块配置、填写 Key、流式响应、存档与重启续玩。可在命令后传入安装后的 EXE 路径。没有真实付费模型调用。

GitHub Actions 的 Windows desktop package 工作流可手动运行，输出安装包、SHA-256 和截图。它是新 runner 的自动检查，不能代替所有真实干净机器、杀毒环境和供应商测试。

## 干净 Windows 验收清单

在没有 Node/npm、没有源码、没有 5173/5180 服务的 Windows 10/11 x64 虚拟机，仅复制安装包：

1. 普通用户安装、从桌面双击，看到书架且无终端。
2. 新建 → 填写 → 取消；书架无空存档。
3. 填写自己的 API、保存 Key；创建故事，主动生成一次，观察流式输出。仅账户所有人决定付费调用。
4. 关闭再开，存档、世界书、预设、模块、连接与选中模型恢复；继续一轮。
5. 关闭后覆盖升级安装，原数据不变；卸载后 data 仍在。
6. 验证安装路径含中文/空格、标准账号无管理员权限、端口已有占用、断网及供应商 429 的提示。

本机没有 Windows Sandbox，因此真正无开发工具的干净 VM 验收仍须执行，不能据自动测试声称已经通过。
