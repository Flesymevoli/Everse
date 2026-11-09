# Word 设定导入

准备页“导入设定（Word / TXT / Markdown）”支持 `.docx`，Word 或 WPS 保存的普通 DOCX 均可尝试。正文、标题文字和表格中的文字提取到现有设定框，可检查和编辑；点击“保存准备”后随草稿保存，确认开局后成为当前存档设定。导入不调用 AI，也不会自动扩写。

这是纯文字导入，不保留字体、编号、表格布局或图片；不提供 OCR。页眉页脚、批注、修订等高级内容可能不完整，页面固定显示兼容提示，解析器警告也保留。旧 `.doc`、宏文档和加密文档不支持，请另存为普通无密码 DOCX。

文件上限2 MB，解压总量上限12 MB、最多1000个条目，提取文字上限10万字符；超限报错，不截断。文件越长仍可能增加模型上下文费用，本功能没有新增长文摘要或检索。

实现：`server/documents.ts` 使用 [Mammoth extractRawText](https://github.com/mwilliamson/mammoth.js#mammothextractrawtextinput) 的纯文字路径（BSD-2-Clause），不用 HTML 渲染。用 [yauzl](https://github.com/thejoshwolfe/yauzl)（MIT）先检查 ZIP 条目并受限解压，拒绝重复路径、宏和自定义 XML 实体，不向磁盘解压，也不加载外部链接。依赖仅安装在项目内。

`POST /api/documents/word?name=...` 接收二进制文件，成功后将原始字节保存在 SQLite `source_documents`；准备页提供下载原件入口。`source.documentId/format/warnings/text` 随草稿和存档保存，修改提取文本不会改原件。废弃导入目前仍留在本地数据库，尚无单独文档清理界面。

验证（2026-11-09）：类型检查、构建、46项自动测试通过。`tests/documents.test.ts` 覆盖中文/段落/转义字符/表格、超限与损坏拒绝、保存准备与开局、原件逐字节下载、零模型调用。浏览器在1440/375/320px验证 DOCX 导入→开场→互动→修正→刷新恢复，没有页面错误或横向溢出。Browser 插件不可用，使用已安装 Playwright，API 路由到隔离内存数据库与模拟模型，未改用户存档。截图和脚本在仓库外 `D:\酒馆\ui-evidence\docx-*`。
