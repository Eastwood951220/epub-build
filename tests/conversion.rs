use std::io::{Cursor, Read};
use txt2epub::{build_epub, parse_book};
use zip::{CompressionMethod, ZipArchive};

#[test]
fn command_converts_a_file() {
    let dir = std::env::temp_dir().join(format!("txt2epub-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("input.txt");
    let output = dir.join("result.epub");
    std::fs::write(&input, "第一章 开始\n正文").unwrap();
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_txt2epub"))
        .args([
            input.to_str().unwrap(),
            output.to_str().unwrap(),
            "--title",
            "自定义书名",
            "--author",
            "张三",
        ])
        .status()
        .unwrap();
    assert!(status.success());
    let mut zip = ZipArchive::new(std::fs::File::open(&output).unwrap()).unwrap();
    let mut opf = String::new();
    zip.by_name("OEBPS/content.opf")
        .unwrap()
        .read_to_string(&mut opf)
        .unwrap();
    assert!(opf.contains("<dc:title>自定义书名</dc:title>"));
    assert!(opf.contains("<dc:creator>张三</dc:creator>"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn splits_chapters_and_preserves_intro() {
    let book = parse_book(
        "序言内容\n\n第一章 开始\n第一段。\n\n第二章 继续\n第二段。",
        "测试书",
    );
    assert_eq!(book.chapters.len(), 3);
    assert_eq!(book.chapters[0].title, "前言");
    assert_eq!(book.chapters[1].title, "第一章 开始");
    assert_eq!(book.chapters[2].paragraphs, vec!["第二段。"]);
}

#[test]
fn plain_text_becomes_one_chapter() {
    let book = parse_book("甲 < 乙 & 丙\n\n第二段", "书名");
    assert_eq!(book.chapters.len(), 1);
    assert_eq!(book.chapters[0].paragraphs, vec!["甲 < 乙 & 丙", "第二段"]);
}

#[test]
fn epub_contains_reading_order_and_escaped_text() {
    let book = parse_book("第一章 A & B\n甲 < 乙", "书 & 名");
    let bytes = build_epub(&book, "作者").unwrap();
    let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert_eq!(zip.by_index(0).unwrap().name().unwrap(), "mimetype");
    assert_eq!(
        zip.by_index(0).unwrap().compression(),
        CompressionMethod::Stored
    );
    let mut content = String::new();
    zip.by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut content)
        .unwrap();
    assert!(content.contains("甲 &lt; 乙"));
    assert!(content.contains("第一章 A &amp; B"));
    content.clear();
    zip.by_name("OEBPS/nav.xhtml")
        .unwrap()
        .read_to_string(&mut content)
        .unwrap();
    assert!(content.contains("text/chapter-1.xhtml"));
    content.clear();
    zip.by_name("OEBPS/content.opf")
        .unwrap()
        .read_to_string(&mut content)
        .unwrap();
    assert!(content.contains("<spine>"));
    assert!(content.contains("idref=\"chapter-1\""));
    assert!(content.contains("<meta property=\"dcterms:modified\">"));
}
