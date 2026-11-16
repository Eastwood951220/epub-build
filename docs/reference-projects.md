# 可借鉴的开源项目

| 项目 | 与 EPUB Studio 的关系 | 借鉴重点 |
| --- | --- | --- |
| [vosslab/rust-html-editor](https://github.com/vosslab/rust-html-editor) | Tauri 2 + TipTap 的图书章节可视化编辑器；EPUB 支持仍列为计划 | 编辑器工具栏、章节侧栏、备份和 CSS 预览的交互方案 |
| [Sigil-Ebook/Sigil](https://github.com/Sigil-Ebook/Sigil) | 成熟的跨平台 EPUB 2/3 编辑器，使用 Qt/C++ | 目录管理、元数据编辑、预览与 EPUB 验证流程 |
| [automataIA/epub-reader-rs](https://github.com/automataIA/epub-reader-rs) | Tauri 桌面 EPUB 阅读器 | ZIP/OPF 解析边界、跨平台构建与发行包设置 |
| [danigm/epub-rs](https://github.com/danigm/epub-rs) | Rust EPUB 读取库 | 后续扩展 EPUB 导入兼容性时可比较其解析行为 |

上述仓库用于研究设计与行为，不直接复制其实现。尤其 Sigil、rust-html-editor 和 epub-rs 为 GPL-3.0 项目，若将其代码集成进本项目，需先处理许可证兼容性。
