# EPUB Studio

使用 Rust 和 TypeScript 构建的 Windows / macOS 电子书编辑器。保留了原来的 `txt2epub` 命令行转换工具。

## 桌面编辑器

需要 Rust、Node.js 24，以及目标系统的 [Tauri 2 构建依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
npm run tauri -- dev
```

生成本机安装包：

```bash
npm run tauri -- build --bundles dmg   # macOS
npm run tauri -- build --bundles nsis  # Windows
```

成品位于 `src-tauri/target/release/bundle/`。仓库中的 GitHub Actions 工作流也会分别构建 macOS DMG 和 Windows NSIS 安装包。

### 使用流程

1. 启动后进入工程书架。点击“新建工程”填写书名、作者和语言；也可以导入 TXT、EPUB 或已有的 `.epubstudio.json` 项目文件。导入 TXT/EPUB 后会先打开“章节核对”，确认分章与分卷后再创建工程。书架会保留多个工程。
2. 首页的“字体库”和“图片库”标签是所有工程共用的 SQLite 资源库，可导入 TTF、OTF、WOFF、WOFF2 字体或 PNG、JPEG、GIF、SVG 图片。在工程编辑器右侧可将资源应用到标题、正文、选中文字、封面、每章首尾或光标处。
3. 封面无需在创建时上传。进入工程后，可在右侧“图书封面”上传或更换；返回书架后显示封面，导出 EPUB 时也会包含封面。导入带 EPUB 3 `cover-image` 或 EPUB 2 封面元数据的图书时，会读取原封面。
4. 左侧选择、添加、删除或调整章节顺序。点击章节后正文从开头显示；卷标题左侧的箭头可折叠、展开该卷。“章节整理”可把误判的章节并回上一章、在任意段落处分章；独立的“查找替换”支持正则、大小写及章节标题、正文、卷标题范围选择。“新建卷”把章节分组到卷，卷可单独设置卷首图、卷尾图和字体样式。左侧出现的“嵌入正文图片”会下载 TXT 中的图片标记并嵌入工程，下载失败的标记会保留供重试。中间编辑正文，选中文字后使用工具栏设置局部字体、字号、颜色、段落样式和对齐；图片按钮在光标处插入图片。右侧统一设置图书信息、章节标题和正文样式，以及每章首尾图片。
5. 切换“预览”查看整本书。“保存工程”写入本机 SQLite；“导出项目文件”生成可移动的 `.epubstudio.json`；“导出 EPUB”生成电子书。

项目文件把已使用的封面、插图和字体嵌入 JSON，因此移动项目文件时不需要再携带原始资源或 SQLite 数据库。字体也会打包进导出的 EPUB。`⌘S`（macOS）或 `Ctrl+S`（Windows）可保存当前工程。

### 当前支持范围

- TXT 需要 UTF-8 编码。GBK 原稿可先用 `iconv -f GBK -t UTF-8 old.txt > book.txt` 转码。
- TXT 按空行或句末标点断段：一行一段的原稿不会被拼成一整段，硬折行的原稿会合并回同一段。
- 章节核对会抽取真实章节名（去掉“第222章”“1、”“1.”“Chapter 3”等编号前缀），再统一重写为“第X章 名称”“X 名称”“X. 名称”“X、名称”或只保留名称；编号可全书连续、每卷从 1 开始，或保留原标题编号只为缺编号的章节补齐。卷标题可在核对列表中直接改名。
- TXT 章节按“第…章/节/回”、“1、标题”、`Chapter N`、序章/楔子/尾声等识别；“第…卷/部/篇”识别为卷，卷内章节自动归组。导入核对时可分别输入自定义章节、卷正则并重新识别，留空使用默认规则。正文中以“第…节”开头的句子不再被误判成章节。
- 卷是章节的上一层分组：卷有独立标题、卷首图、卷尾图和可覆盖全书的字体样式；导出时生成卷首页、嵌套目录，并给卷内章节加上 `volume-N` 样式类。
- EPUB 导入面向无 DRM 的流式 EPUB 2/3，按 spine 阅读顺序和章节主标题拆章，保留常见段落、标题、强调、图片及章节内部链接。脚本、任意外部 CSS 和固定版式不会作为可编辑内容保留。
- 图片支持 PNG、JPEG、GIF、SVG；正文图片链接转换还支持 WebP。统一首尾图在导出包中复用同一资源。
- 预览使用当前项目样式；实际阅读器可能允许读者覆盖字体设置。

## 命令行 TXT 转 EPUB

```bash
cargo run -- book.txt
cargo run -- book.txt output.epub --title "书名" --author "作者"
```

省略输出路径时，在输入文件旁创建同名 `.epub`。

## 验证

```bash
npm test
npm run build
cargo test
cargo test --manifest-path src-tauri/Cargo.toml
```
