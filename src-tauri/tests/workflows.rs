use epub_studio::project::{
    export_epub, import_book, import_txt_with_patterns, load_project, save_project,
};
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
fn optional_first_line_indent_survives_save_and_controls_epub_css() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.style.body_first_line_indent = true;
    let saved = dir.path().join("book.json");
    save_project(&project, &saved).unwrap();
    let loaded = load_project(&saved).unwrap();
    assert!(loaded.style.body_first_line_indent);
    let epub = dir.path().join("book.epub");
    export_epub(&loaded, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(epub).unwrap()).unwrap();
    let mut css = String::new();
    archive.by_name("OEBPS/styles/book.css").unwrap().read_to_string(&mut css).unwrap();
    assert!(css.contains("p{margin:0 0 .9em;text-indent:2em}"));

    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&saved).unwrap()).unwrap();
    legacy["style"].as_object_mut().unwrap().remove("bodyFirstLineIndent");
    fs::write(&saved, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(!load_project(&saved).unwrap().style.body_first_line_indent);
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
fn txt_custom_rules_create_volume_groups() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(
        &input,
        "卷一：开端\n第1话 初见\n正文。\n第2话 告别\n正文。\n卷二：归来\n第1话 重逢\n正文。",
    )
    .unwrap();
    let project =
        import_txt_with_patterns(&input, Some(r"^第\d+话\s+.+$"), Some(r"^卷[一二]：.+$")).unwrap();
    assert_eq!(project.volumes.len(), 2);
    assert_eq!(project.chapters.len(), 3);
    assert_eq!(project.chapters[0].volume_id.as_deref(), Some("volume-1"));
    assert_eq!(project.chapters[2].volume_id.as_deref(), Some("volume-2"));
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

#[test]
fn txt_import_keeps_one_paragraph_per_line() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n第一段。\n第二段。\n第三段。").unwrap();
    let project = import_book(&input).unwrap();
    assert_eq!(project.chapters.len(), 1);
    assert_eq!(
        project.chapters[0].html,
        "<p>第一段。</p><p>第二段。</p><p>第三段。</p>"
    );
}

#[test]
fn volumes_get_their_own_pages_styles_and_images() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(
        &input,
        "第一卷 少年\n第一章 开始\n正文一。\n第二章 继续\n正文二。\n第二卷 远方\n第三章 远行\n正文三。",
    )
    .unwrap();
    let mut project = import_book(&input).unwrap();
    assert_eq!(project.volumes.len(), 2);
    assert_eq!(project.chapters.len(), 3);
    assert_eq!(
        project.chapters[0].volume_id.as_deref(),
        Some(project.volumes[0].id.as_str())
    );
    assert_eq!(
        project.chapters[1].volume_id.as_deref(),
        Some(project.volumes[0].id.as_str())
    );
    assert_eq!(
        project.chapters[2].volume_id.as_deref(),
        Some(project.volumes[1].id.as_str())
    );
    project.volumes[1].style.body_font_size = Some(24);
    project.volumes[1].opening_image = Some("data:image/png;base64,iVBORw0KGgo=".into());
    project.volumes[0].closing_image = Some("data:image/png;base64,iVBORw0KGgo=".into());
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();

    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut volume = String::new();
    archive
        .by_name("OEBPS/text/volume-2.xhtml")
        .unwrap()
        .read_to_string(&mut volume)
        .unwrap();
    assert!(volume.contains("第二卷 远方"));
    assert!(volume.contains("class=\"volume-2\""));
    assert!(volume.contains("../images/image-"));
    assert!(!volume.contains("data:image"));

    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-3.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("class=\"volume-2\""));

    let mut second = String::new();
    archive
        .by_name("OEBPS/text/chapter-2.xhtml")
        .unwrap()
        .read_to_string(&mut second)
        .unwrap();
    assert!(second.contains("卷尾图片"));

    let mut css = String::new();
    archive
        .by_name("OEBPS/styles/book.css")
        .unwrap()
        .read_to_string(&mut css)
        .unwrap();
    assert!(css.contains("body.volume-2{"));
    assert!(css.contains("font-size:24px"));

    let mut nav = String::new();
    archive
        .by_name("OEBPS/nav.xhtml")
        .unwrap()
        .read_to_string(&mut nav)
        .unwrap();
    assert!(nav.contains("text/volume-1.xhtml"));
    assert!(nav.contains("<ol>"));
    roxmltree::Document::parse(&nav).unwrap();
}
