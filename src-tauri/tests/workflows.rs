use epub_studio::project::{
    ChapterImage, ChapterImagePlacement, ChapterImageScope, export_epub, import_book,
    import_txt_with_patterns, load_project, save_project,
};
use std::{fs, io::Read};
use tempfile::tempdir;
use zip::{CompressionMethod, ZipArchive};

#[test]
fn chapter_notes_export_at_chapter_end_with_links_and_styles() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.chapters[0].html = "<p>正文<span data-note-id=\"n1\">[1]</span></p>".into();
    project.chapters[0]
        .notes
        .push(epub_studio::project::ChapterNote {
            id: "n1".into(),
            text: "备注<&>".into(),
        });
    project.style.note_font_size = 14;
    project.style.note_marker_color = "#aabbcc".into();
    let saved = dir.path().join("book.json");
    save_project(&project, &saved).unwrap();
    let project = load_project(&saved).unwrap();
    assert_eq!(project.chapters[0].notes[0].text, "备注<&>");
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("href=\"#note-n1\""));
    assert!(chapter.contains("id=\"note-n1\""));
    assert!(chapter.contains("备注&lt;&amp;&gt;"));
    assert!(chapter.find("正文").unwrap() < chapter.find("备注&lt;&amp;&gt;").unwrap());
    let mut css = String::new();
    archive
        .by_name("OEBPS/styles/book.css")
        .unwrap()
        .read_to_string(&mut css)
        .unwrap();
    assert!(css.contains("font-size:14px;color:#526963"));
    assert!(css.contains("color:#aabbcc"));
    let imported = import_book(&epub).unwrap();
    assert_eq!(imported.chapters[0].notes[0].text, "备注<&>");
    assert!(imported.chapters[0].html.contains("data-note-id=\"n1\""));
}

#[test]
fn chapter_and_volume_titles_export_as_separately_styled_lines() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一卷：少年\n第一章 开始\n正文\n\n第二章 继续\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.style.chapter_number_style.font_size = Some(18);
    project.style.chapter_number_style.color = Some("#aa3344".into());
    project.style.volume_name_style.font_size = Some(38);
    project.chapters[0].title_layout = epub_studio::project::TitleLayout::Inline;
    project.volumes[0].title_layout = epub_studio::project::TitleLayout::Stacked;
    let saved = dir.path().join("book.json");
    save_project(&project, &saved).unwrap();
    let project = load_project(&saved).unwrap();
    assert_eq!(project.chapters[0].title_layout, epub_studio::project::TitleLayout::Inline);
    assert_eq!(project.volumes[0].title_layout, epub_studio::project::TitleLayout::Stacked);
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut chapter = String::new();
    archive.by_name("OEBPS/text/chapter-1.xhtml").unwrap().read_to_string(&mut chapter).unwrap();
    assert!(chapter.contains("class=\"chapter-heading title-inline\""));
    assert!(chapter.contains("<span class=\"heading-number\">第一章</span><span class=\"heading-name\">开始</span>"));
    let mut next_chapter = String::new();
    archive.by_name("OEBPS/text/chapter-2.xhtml").unwrap().read_to_string(&mut next_chapter).unwrap();
    assert!(next_chapter.contains("class=\"chapter-heading title-stacked\""));
    let mut volume = String::new();
    archive.by_name("OEBPS/text/volume-1.xhtml").unwrap().read_to_string(&mut volume).unwrap();
    assert!(volume.contains("class=\"volume-heading title-stacked\""));
    assert!(volume.contains("<span class=\"heading-number\">第一卷</span><span class=\"heading-name\">少年</span>"));
    let mut css = String::new();
    archive.by_name("OEBPS/styles/book.css").unwrap().read_to_string(&mut css).unwrap();
    assert!(css.contains(".chapter-heading .heading-number"));
    assert!(css.contains("font-size:18px;color:#aa3344"));
    assert!(css.contains(".volume-heading .heading-name"));
    assert!(css.contains("font-size:38px"));
    let imported = import_book(&epub).unwrap();
    assert!(imported.chapters.iter().any(|chapter| chapter.title == "第一章 开始"));
    assert!(imported.chapters.iter().any(|chapter| chapter.title == "第一章 开始" && chapter.title_layout == epub_studio::project::TitleLayout::Inline));
}

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
fn shared_library_font_is_embedded_in_exported_epub() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.font_assets.push(epub_studio::project::EmbeddedFont {
        family: "EPUBStudioLibraryFont1".into(),
        name: "公用字体".into(),
        mime: "font/ttf".into(),
        data_uri: "data:font/ttf;base64,AAEAAHRlc3Q=".into(),
    });
    project.style.body_font_family = "EPUBStudioLibraryFont1".into();
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(epub).unwrap()).unwrap();
    let mut css = String::new();
    archive.by_name("OEBPS/styles/book.css").unwrap().read_to_string(&mut css).unwrap();
    assert!(css.contains("@font-face{font-family:'EPUBStudioLibraryFont1'"));
    assert!(css.contains("font-family:'EPUBStudioLibraryFont1',serif"));
    assert!(archive.by_name("OEBPS/fonts/font-1.ttf").is_ok());
}

#[test]
fn epub_includes_only_referenced_fonts_from_styles_and_inline_text() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一卷 少年\n第一章 开始\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    for number in 1..=5 {
        project.font_assets.push(epub_studio::project::EmbeddedFont {
            family: format!("EPUBStudioFont{number}"),
            name: format!("Font {number}"),
            mime: "font/ttf".into(),
            data_uri: "data:font/ttf;base64,AAEAAHRlc3Q=".into(),
        });
    }
    project.style.body_font_family = "EPUBStudioFont2".into();
    project.style.chapter_name_style.font_family = Some("EPUBStudioFont3".into());
    project.volumes[0].style.title_font_family = Some("EPUBStudioFont4".into());
    project.chapters[0].html =
        "<p><span style=\"font-family: 'EPUBStudioFont5'\">正文</span></p>".into();
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(epub).unwrap()).unwrap();
    let mut css = String::new();
    archive.by_name("OEBPS/styles/book.css").unwrap().read_to_string(&mut css).unwrap();
    assert!(!css.contains("EPUBStudioFont1"));
    for number in 2..=5 {
        assert!(css.contains(&format!("@font-face{{font-family:'EPUBStudioFont{number}'")));
    }
    assert!(archive.by_name("OEBPS/fonts/font-4.ttf").is_ok());
    assert!(archive.by_name("OEBPS/fonts/font-5.ttf").is_err());
    let mut opf = String::new();
    archive.by_name("OEBPS/content.opf").unwrap().read_to_string(&mut opf).unwrap();
    assert!(opf.contains("fonts/font-4.ttf"));
    assert!(!opf.contains("fonts/font-5.ttf"));
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
    assert!(css.contains("p{margin:0 0 0.90em;text-indent:2em}"));

    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&saved).unwrap()).unwrap();
    legacy["style"].as_object_mut().unwrap().remove("bodyFirstLineIndent");
    fs::write(&saved, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(!load_project(&saved).unwrap().style.body_first_line_indent);
}

#[test]
fn paragraph_and_chapter_title_spacing_survive_save_and_control_epub_css() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文").unwrap();
    let mut project = import_book(&input).unwrap();
    project.style.body_paragraph_spacing = 1.4;
    project.style.chapter_body_spacing = 72;
    let saved = dir.path().join("book.json");
    save_project(&project, &saved).unwrap();
    let loaded = load_project(&saved).unwrap();
    assert_eq!(loaded.style.body_paragraph_spacing, 1.4);
    assert_eq!(loaded.style.chapter_body_spacing, 72);
    let epub = dir.path().join("book.epub");
    export_epub(&loaded, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(epub).unwrap()).unwrap();
    let mut css = String::new();
    archive.by_name("OEBPS/styles/book.css").unwrap().read_to_string(&mut css).unwrap();
    assert!(css.contains("p{margin:0 0 1.40em"));
    assert!(css.contains(".chapter-heading{margin-bottom:72px}"));

    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&saved).unwrap()).unwrap();
    legacy["style"].as_object_mut().unwrap().remove("bodyParagraphSpacing");
    legacy["style"].as_object_mut().unwrap().remove("chapterBodySpacing");
    fs::write(&saved, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let old = load_project(&saved).unwrap();
    assert_eq!(old.style.body_paragraph_spacing, 0.9);
    assert_eq!(old.style.chapter_body_spacing, 46);
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
    project.chapter_images.push(ChapterImage {
        id: "image-1".into(),
        image: "data:image/png;base64,iVBORw0KGgo=".into(),
        placement: ChapterImagePlacement::Below,
        scope: ChapterImageScope::All,
    });
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
    // 章节插图导出后在每章标题下重复出现，再导入时会被折回章节插图，
    // 所以图片可能出现在正文里，也可能出现在 chapter_images 里。
    assert!(
        imported.chapters[0].html.contains("data:image/png;base64,")
            || imported
                .chapter_images
                .iter()
                .any(|entry| entry.image.starts_with("data:image/png;base64,"))
    );
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
    project.chapter_images.push(ChapterImage {
        id: "broken".into(),
        image: "data:image/png;base64,not-valid-!".into(),
        placement: ChapterImagePlacement::Above,
        scope: ChapterImageScope::All,
    });
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
    assert!(chapter.contains("<h1 class=\"chapter-heading title-stacked\" id=\"two\"><span class=\"heading-name\">Two</span></h1>"));
}

#[test]
fn epub_import_turns_volume_pages_into_volumes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("volumes.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<package><metadata><title>Volumes</title></metadata><manifest><item id="v" href="volume.xhtml"/><item id="c" href="one.xhtml"/><item id="d" href="two.xhtml"/></manifest><spine><itemref idref="v"/><itemref idref="c"/><itemref idref="d"/></spine></package>"#).unwrap();
    zip.start_file("OEBPS/volume.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><h1>卷丨壹丨</h1><p>风起</p></body></html>"#.as_bytes()).unwrap();
    zip.start_file("OEBPS/one.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><h2>第壹章 开端</h2><p>正文一</p></body></html>"#.as_bytes()).unwrap();
    zip.start_file("OEBPS/two.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><h2>第贰章 继续</h2><p>正文二</p></body></html>"#.as_bytes()).unwrap();
    zip.finish().unwrap();

    let project = import_book(&path).unwrap();
    assert_eq!(project.chapters.len(), 2, "卷页不该变成章节");
    assert_eq!(project.volumes.len(), 1);
    assert_eq!(project.volumes[0].title, "卷丨壹丨 风起");
    assert_eq!(
        project.chapters[0].volume_id.as_deref(),
        Some(project.volumes[0].id.as_str())
    );
    assert_eq!(
        project.chapters[1].volume_id.as_deref(),
        Some(project.volumes[0].id.as_str())
    );
}

#[test]
fn epub_import_accepts_documents_with_doctype() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("xhtml11.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<?xml version="1.0"?><package><metadata><title>Doctype book</title></metadata><manifest><item id="c" href="book.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>"#).unwrap();
    zip.start_file("OEBPS/book.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r##"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>正文</p></body></html>"##.as_bytes()).unwrap();
    zip.finish().unwrap();

    let project = import_book(&path).unwrap();
    assert_eq!(project.title, "Doctype book");
    assert_eq!(project.chapters.len(), 1);
    assert_eq!(project.chapters[0].title, "One");
    assert!(project.chapters[0].html.contains("正文"));
}

#[test]
fn epub_import_keeps_image_only_intro_with_its_chapter() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("illustrated.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<package><metadata><title>Book</title></metadata><manifest><item id="front" href="front.xhtml"/><item id="c" href="book.xhtml"/><item id="p" href="images/p.png" media-type="image/png"/></manifest><spine><itemref idref="front"/><itemref idref="c"/></spine></package>"#).unwrap();
    zip.start_file("OEBPS/images/p.png", options).unwrap();
    std::io::Write::write_all(&mut zip, &[0x89, b'P', b'N', b'G']).unwrap();
    zip.start_file("OEBPS/front.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><p>前言</p><h2>第一章</h2><p>正文</p></body></html>"#.as_bytes()).unwrap();
    zip.start_file("OEBPS/book.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><div><img src="images/p.png"/></div><h2>第二章</h2><p>正文二</p></body></html>"#.as_bytes()).unwrap();
    zip.finish().unwrap();

    let project = import_book(&path).unwrap();
    // 前言有文字，保留为独立章节；只有插图的页并入它后面的章节。
    assert_eq!(project.chapters.len(), 3);
    assert_eq!(project.chapters[0].title, "章节 1");
    assert!(project.chapters[0].html.contains("前言"));
    assert_eq!(project.chapters[1].title, "第一章");
    assert_eq!(project.chapters[2].title, "第二章");
    assert!(
        project.chapters[2].html.contains("data:image/png;base64,"),
        "chapter illustration must stay in its chapter body"
    );
    assert!(project.chapters[2].html.contains("正文二"));
}

#[test]
fn epub_import_hoists_repeated_leading_images_into_chapter_images() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("repeated.epub");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<package><metadata><title>Book</title></metadata><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/><item id="c" href="c.xhtml"/><item id="p" href="images/p.png" media-type="image/png"/><item id="q" href="images/q.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>"#).unwrap();
    for (name, bytes) in [("p", &[0x89u8, b'P', b'N', b'G'][..]), ("q", &[0x89, b'P', b'N', b'G', b'2'][..])] {
        zip.start_file(format!("OEBPS/images/{name}.png"), options).unwrap();
        std::io::Write::write_all(&mut zip, &bytes).unwrap();
    }
    zip.start_file("OEBPS/a.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><div><img src="images/p.png"/></div><h2>第一章</h2><p>正文一</p></body></html>"#.as_bytes()).unwrap();
    zip.start_file("OEBPS/b.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><div><img src="images/p.png"/></div><h2>第二章</h2><p>正文二</p></body></html>"#.as_bytes()).unwrap();
    zip.start_file("OEBPS/c.xhtml", options).unwrap();
    std::io::Write::write_all(&mut zip, r#"<html><body><h2>第三章</h2><p>正文三</p><p><img src="images/q.png"/></p></body></html>"#.as_bytes()).unwrap();
    zip.finish().unwrap();

    let project = import_book(&path).unwrap();
    assert_eq!(project.chapters.len(), 3);
    // 两章开头的同一张图提取为一张章节插图，正文里不再内联。
    assert_eq!(project.chapter_images.len(), 1);
    let image = &project.chapter_images[0];
    assert!(image.image.starts_with("data:image/png;base64,"));
    assert_eq!(image.placement, ChapterImagePlacement::Above);
    assert_eq!(
        image.scope,
        ChapterImageScope::Chapters {
            ids: vec!["chapter-1".into(), "chapter-2".into()]
        }
    );
    assert!(!project.chapters[0].html.contains("<img"));
    assert!(!project.chapters[1].html.contains("<img"));
    // 只出现一次的正文插图保持原样。
    assert!(project.chapters[2].html.contains("<img"));
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

#[test]
fn chapter_images_follow_placement_and_scope() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(
        &input,
        "第一卷 少年\n第一章 开始\n正文一。\n第二章 继续\n正文二。\n第二卷 远方\n第三章 远行\n正文三。",
    )
    .unwrap();
    let mut project = import_book(&input).unwrap();
    assert_eq!(project.volumes.len(), 2);
    project.chapter_images.push(ChapterImage {
        id: "above-all".into(),
        image: "data:image/png;base64,iVBORw0KGgo=".into(),
        placement: ChapterImagePlacement::Above,
        scope: ChapterImageScope::All,
    });
    let first_volume = project.volumes[0].id.clone();
    project.chapter_images.push(ChapterImage {
        id: "below-volume-1".into(),
        image: "data:image/png;base64,iVBORw0KGgo=".into(),
        placement: ChapterImagePlacement::Below,
        scope: ChapterImageScope::Volumes { ids: vec![first_volume] },
    });
    let second_chapter = project.chapters[1].id.clone();
    project.chapter_images.push(ChapterImage {
        id: "above-chapter-2".into(),
        image: "data:image/png;base64,iVBORw0KGgo=".into(),
        placement: ChapterImagePlacement::Above,
        scope: ChapterImageScope::Chapters { ids: vec![second_chapter] },
    });

    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();

    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    let heading = chapter.find("<h1").unwrap();
    let above = chapter.find("章节标题上方图片").unwrap();
    let below = chapter.find("章节标题下方图片").unwrap();
    assert!(above < heading, "above-title image must precede the heading");
    assert!(heading < below, "below-title image must follow the heading");
    assert!(!chapter.contains("卷尾图片"));

    let mut chapter_two = String::new();
    archive
        .by_name("OEBPS/text/chapter-2.xhtml")
        .unwrap()
        .read_to_string(&mut chapter_two)
        .unwrap();
    // Chapter 2 sits in volume 1, so both the volume-scoped and the chapter-scoped images apply.
    assert!(chapter_two.find("章节标题上方图片").unwrap() < chapter_two.find("<h1").unwrap());
    assert!(chapter_two.find("<h1").unwrap() < chapter_two.find("章节标题下方图片").unwrap());

    let mut chapter_three = String::new();
    archive
        .by_name("OEBPS/text/chapter-3.xhtml")
        .unwrap()
        .read_to_string(&mut chapter_three)
        .unwrap();
    assert!(chapter_three.contains("章节标题上方图片"));
    assert!(!chapter_three.contains("章节标题下方图片"));
}

#[test]
fn legacy_opening_image_migrates_into_chapter_images() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("old.epubstudio.json");
    fs::write(
        &path,
        r#"{"version":1,"title":"旧书","author":"作者","language":"zh-CN","style":{},"coverImage":null,"openingImage":"data:image/png;base64,iVBORw0KGgo=","closingImage":"data:image/png;base64,iVBORw0KGgo=","fontAssets":[],"volumes":[],"chapters":[{"id":"chapter-1","title":"第一章 开始","html":"<p>正文</p>"}]}"#,
    )
    .unwrap();
    let project = load_project(&path).unwrap();
    assert_eq!(project.chapter_images.len(), 1);
    assert_eq!(project.chapter_images[0].placement, ChapterImagePlacement::Below);
    assert_eq!(project.chapter_images[0].scope, ChapterImageScope::All);
    assert_eq!(
        project.chapter_images[0].image,
        "data:image/png;base64,iVBORw0KGgo="
    );
    assert!(project.opening_image.is_none());
    assert!(project.closing_image.is_none());

    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("章节标题下方图片"));
}

#[test]
fn body_images_export_as_centered_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文。").unwrap();
    let mut project = import_book(&input).unwrap();
    project.chapters[0]
        .html
        .push_str("<img src=\"data:image/png;base64,iVBORw0KGgo=\" alt=\"插图\" />");
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut css = String::new();
    archive
        .by_name("OEBPS/styles/book.css")
        .unwrap()
        .read_to_string(&mut css)
        .unwrap();
    assert!(
        css.contains("img{display:block;margin:1.2em auto;max-width:100%;height:auto}"),
        "body images must be block level so auto margins center them in Apple Books"
    );
    assert!(
        css.contains(".chapter-image img{margin:0 auto}"),
        "chapter title images must stay centered once images are block level"
    );
    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("<img src=\"../images/image-1.png\" alt=\"插图\" />"));
    roxmltree::Document::parse(&chapter).unwrap();
}

#[test]
fn selected_text_colour_survives_export() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文。").unwrap();
    let mut project = import_book(&input).unwrap();
    project.chapters[0].html =
        "<p>普通文字<span style=\"color: rgb(220, 38, 38);\">红色文字</span></p>".into();
    let epub = dir.path().join("book.epub");
    export_epub(&project, &epub).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&epub).unwrap()).unwrap();
    let mut chapter = String::new();
    archive
        .by_name("OEBPS/text/chapter-1.xhtml")
        .unwrap()
        .read_to_string(&mut chapter)
        .unwrap();
    assert!(chapter.contains("<span style=\"color: rgb(220, 38, 38);\">红色文字</span>"));
    roxmltree::Document::parse(&chapter).unwrap();
}
