use epub_studio::project::{export_epub, import_book, load_project, save_project};
use std::{fs, io::Read};
use tempfile::tempdir;
use zip::{CompressionMethod, ZipArchive};

#[test]
fn selected_font_is_saved_and_embedded_in_epub() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project
        .font_assets
        .push(epub_studio::project::EmbeddedFont {
            family: "EPUBStudioFont7".into(),
            name: "Sample".into(),
            mime: "font/ttf".into(),
            data_uri: "data:font/ttf;base64,AAEAAHRlc3Q=".into(),
        });
    project.style.body_font_family = "EPUBStudioFont7".into();
    project.chapters[0].html =
        "<p><span style=\"font-family: EPUBStudioFont7\">正文</span></p>".into();
    let saved = dir.path().join("book.json");
    save_project(&project, &saved).unwrap();
    let loaded = load_project(&saved).unwrap();
    let epub = dir.path().join("book.epub");
    export_epub(&loaded, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(epub).unwrap()).unwrap();
    let mut css = String::new();
    archive
        .by_name("OEBPS/styles/book.css")
        .unwrap()
        .read_to_string(&mut css)
        .unwrap();
    assert!(css.contains("@font-face{font-family:'EPUBStudioFont7'"));
    assert!(css.contains("font-family:'EPUBStudioFont7',serif"));
    let mut font = Vec::new();
    archive
        .by_name("OEBPS/fonts/font-1.ttf")
        .unwrap()
        .read_to_end(&mut font)
        .unwrap();
    assert_eq!(font, b"\0\x01\0\0test");
}

#[test]
fn txt_import_creates_editable_chapters() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("我的书.txt");
    fs::write(
        &input,
        "前言\n\n第一章 开始\n正文 & 更多\n\n第二章 结束\n完",
    )
    .unwrap();
    let project = import_book(&input).unwrap();
    assert_eq!(project.title, "我的书");
    assert_eq!(project.chapters.len(), 3);
    assert_eq!(project.chapters[1].title, "第一章 开始");
    assert!(project.chapters[1].html.contains("正文 &amp; 更多"));
}

#[test]
fn project_save_load_and_epub_export_round_trip() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n第一段\n\n第二章 结束\n第二段").unwrap();
    let mut project = import_book(&input).unwrap();
    project.author = "作者".into();
    project.style.body_font_size = 20;
    project.opening_image = Some("data:image/png;base64,iVBORw0KGgo=".into());
    project.cover_image = Some("data:image/png;base64,iVBORw0KGgo=".into());
    project.chapters[0]
        .html
        .push_str("<p><strong>加粗</strong></p>");
    let saved = dir.path().join("book.epubstudio.json");
    save_project(&project, &saved).unwrap();
    assert_eq!(load_project(&saved).unwrap(), project);

    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    assert_eq!(archive.by_index(0).unwrap().name().unwrap(), "mimetype");
    assert_eq!(
        archive.by_index(0).unwrap().compression(),
        CompressionMethod::Stored
    );
    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("<strong>加粗</strong>"));
    assert!(chapter.contains("../images/image-1.png"));
    let mut css = String::new();
    archive
        .by_name("OEBPS/styles/book.css")
        .unwrap()
        .read_to_string(&mut css)
        .unwrap();
    assert!(css.contains("font-size:20px"));
    let mut opf = String::new();
    archive
        .by_name("OEBPS/content.opf")
        .unwrap()
        .read_to_string(&mut opf)
        .unwrap();
    assert!(opf.contains("properties=\"cover-image\""));
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name
                .as_ref()
                .is_ok_and(|name| name.starts_with("OEBPS/images/")))
            .count(),
        1
    );
    drop(archive);
    let imported = import_book(&epub).unwrap();
    assert_eq!(imported.title, "book");
    assert_eq!(
        imported.cover_image.as_deref(),
        Some("data:image/png;base64,iVBORw0KGgo=")
    );
    assert_eq!(imported.chapters.len(), 2);
    assert!(imported.chapters[0].html.contains("<strong>加粗</strong>"));
    assert!(imported.chapters[0].html.contains("data:image/png;base64,"));
}

#[test]
fn exported_editor_html_is_valid_xhtml() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.chapters[0].html = "<p>第一行<br>第二行&nbsp;</p><hr>".into();
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut xhtml = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut xhtml)
        .unwrap();
    roxmltree::Document::parse(&xhtml).unwrap();
}

#[test]
fn failed_export_keeps_existing_epub() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.opening_image = Some("data:image/png;base64,not-valid-!".into());
    let output = dir.path().join("existing.epub");
    fs::write(&output, b"previous good book").unwrap();
    assert!(export_epub(&project, &output).is_err());
    assert_eq!(fs::read(output).unwrap(), b"previous good book");
}

#[test]
fn epub_import_splits_headings_and_keeps_internal_links() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("one-file.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<package><metadata><title>Two chapters</title></metadata><manifest><item id="c" href="book.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>"#).unwrap();
    zip.start_file("OEBPS/book.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, br##"<html><body><h1>One</h1><p><a href="#two">next</a></p><h1 id="two">Two</h1><p id="ending">Finish</p></body></html>"##).unwrap();
    zip.finish().unwrap();

    let project = import_book(&path).unwrap();
    assert_eq!(project.chapters.len(), 2);
    assert_eq!(project.chapters[1].title, "Two");
    assert!(
        project.chapters[0]
            .html
            .contains("href=\"chapter-2.xhtml#two\"")
    );
    assert!(project.chapters[1].html.contains("id=\"ending\""));
    let output = dir.path().join("roundtrip.epub");
    export_epub(&project, &output).unwrap();
    let mut output_zip = ZipArchive::new(fs::File::open(output).unwrap()).unwrap();
    let mut chapter = String::new();
    output_zip
        .by_name("OEBPS/text/chapter-2.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("<h1 id=\"two\">Two</h1>"));
}
