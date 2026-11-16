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

1. 点击“导入 TXT / EPUB”，选择原稿；也可以直接在空白项目里新增章节写作。
2. 左侧选择、添加、删除或调整章节顺序。中间编辑正文，选中文字后使用工具栏设置局部字体、字号、颜色、段落样式和对齐；图片按钮在光标处插入图片。
3. 右侧统一设置图书信息、章节标题和正文的字体、字号、对齐及行距。可指定所有章节开头和末尾使用的图片。
4. 右侧切换到“资源库”，可导入 TTF、OTF、WOFF、WOFF2 字体或 PNG、JPEG、GIF、SVG 图片，预览后应用到标题、正文、选中文字、每章首尾或光标处。资源保存在应用数据目录下的 SQLite 数据库中；从库中删除资源不会移除已加入书稿的内容。
5. 切换“预览”查看整本书。点击“保存项目”保存为 `.epubstudio.json`，以后可通过“打开项目”继续编辑；点击“导出 EPUB”生成电子书。

项目文件把已使用的插图和字体嵌入 JSON，因此移动项目文件时不需要再携带原始资源或 SQLite 数据库。字体也会打包进导出的 EPUB。`⌘S`（macOS）或 `Ctrl+S`（Windows）可保存项目。

### 当前支持范围

- TXT 需要 UTF-8 编码。GBK 原稿可先用 `iconv -f GBK -t UTF-8 old.txt > book.txt` 转码。
- EPUB 导入面向无 DRM 的流式 EPUB 2/3，按 spine 阅读顺序和章节主标题拆章，保留常见段落、标题、强调、图片及章节内部链接。脚本、任意外部 CSS 和固定版式不会作为可编辑内容保留。
- 图片支持 PNG、JPEG、GIF、SVG。统一首尾图在导出包中复用同一资源。
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
