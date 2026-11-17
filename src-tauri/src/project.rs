use base64::{Engine, engine::general_purpose::STANDARD};
use percent_encoding::percent_decode_str;
use regex::Regex;
use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, Write},
    path::Path,
};
use tempfile::NamedTempFile;
use time::{OffsetDateTime, macros::format_description};
use txt2epub::ChapterKind;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub title: String,
    pub author: String,
    pub language: String,
    pub style: BookStyle,
    #[serde(default)]
    pub cover_image: Option<String>,
    pub opening_image: Option<String>,
    pub closing_image: Option<String>,
    #[serde(default)]
    pub font_assets: Vec<EmbeddedFont>,
    /// Shared volume library; chapters point at a volume through `volume_id`.
    #[serde(default)]
    pub volumes: Vec<Volume>,
    pub chapters: Vec<EditableChapter>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VolumeStyle {
    pub title_font_family: Option<String>,
    pub title_font_size: Option<u16>,
    pub title_align: Option<String>,
    pub body_font_family: Option<String>,
    pub body_font_size: Option<u16>,
    pub body_line_height: Option<f32>,
    pub body_align: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub id: String,
    pub title: String,
    /// Empty object means "inherit the book style".
    #[serde(default)]
    pub style: VolumeStyle,
    #[serde(default)]
    pub opening_image: Option<String>,
    #[serde(default)]
    pub closing_image: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedFont {
    pub family: String,
    pub name: String,
    pub mime: String,
    pub data_uri: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookStyle {
    pub title_font_family: String,
    pub title_font_size: u16,
    pub title_align: String,
    pub body_font_family: String,
    pub body_font_size: u16,
    pub body_line_height: f32,
    pub body_align: String,
    #[serde(default)]
    pub body_first_line_indent: bool,
}

impl Default for BookStyle {
    fn default() -> Self {
        Self {
            title_font_family: "serif".into(),
            title_font_size: 30,
            title_align: "center".into(),
            body_font_family: "serif".into(),
            body_font_size: 18,
            body_line_height: 1.8,
            body_align: "justify".into(),
            body_first_line_indent: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditableChapter {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub title_id: Option<String>,
    #[serde(default)]
    pub volume_id: Option<String>,
    pub html: String,
}

pub fn import_book(path: &Path) -> Result<Project, String> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("txt") => import_txt(path),
        Some("epub") => import_epub(path),
        _ => Err("请选择 .txt 或 .epub 文件".into()),
    }
}

fn paragraphs_html(paragraphs: &[String]) -> String {
    paragraphs
        .iter()
        .map(|p| format!("<p>{}</p>", escape_xml(p)))
        .collect()
}

fn import_txt(path: &Path) -> Result<Project, String> {
    import_txt_with_patterns(path, None, None)
}

pub fn import_txt_with_patterns(
    path: &Path,
    chapter_pattern: Option<&str>,
    volume_pattern: Option<&str>,
) -> Result<Project, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("读取 TXT 失败（文件需要是 UTF-8）：{e}"))?;
    let title = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let book = txt2epub::parse_book_with_patterns(&text, &title, chapter_pattern, volume_pattern)?;
    if book
        .chapters
        .iter()
        .all(|c| !matches!(c.kind, ChapterKind::Volume) && c.paragraphs.is_empty())
    {
        return Err("TXT 文件没有正文".into());
    }
    let mut volumes: Vec<Volume> = Vec::new();
    let mut chapters: Vec<EditableChapter> = Vec::new();
    let mut current_volume: Option<String> = None;
    for chapter in book.chapters {
        match chapter.kind {
            ChapterKind::Volume => {
                let id = format!("volume-{}", volumes.len() + 1);
                volumes.push(Volume {
                    id: id.clone(),
                    title: chapter.title.clone(),
                    style: VolumeStyle::default(),
                    opening_image: None,
                    closing_image: None,
                });
                current_volume = Some(id.clone());
                // Text placed directly under a volume heading stays, as its opening chapter.
                if !chapter.paragraphs.is_empty() {
                    chapters.push(EditableChapter {
                        id: format!("chapter-{}", chapters.len() + 1),
                        title: chapter.title,
                        title_id: None,
                        volume_id: Some(id),
                        html: paragraphs_html(&chapter.paragraphs),
                    });
                }
            }
            ChapterKind::Chapter => chapters.push(EditableChapter {
                id: format!("chapter-{}", chapters.len() + 1),
                title: chapter.title,
                title_id: None,
                volume_id: current_volume.clone(),
                html: paragraphs_html(&chapter.paragraphs),
            }),
        }
    }
    // A volume heading without chapters would export an empty page; drop it and
    // keep everything else untouched.
    volumes.retain(|volume| {
        chapters
            .iter()
            .any(|chapter| chapter.volume_id.as_deref() == Some(volume.id.as_str()))
    });
    Ok(Project {
        version: 1,
        title,
        author: "未知作者".into(),
        language: "zh-CN".into(),
        style: BookStyle::default(),
        cover_image: None,
        opening_image: None,
        closing_image: None,
        font_assets: Vec::new(),
        volumes,
        chapters,
    })
}

pub fn save_project(book: &Project, path: &Path) -> Result<(), String> {
    validate_project(book)?;
    let data = serde_json::to_vec_pretty(book).map_err(|e| e.to_string())?;
    let parent = path.parent().unwrap_or(Path::new("."));
    let mut temporary = NamedTempFile::new_in(parent).map_err(|e| format!("保存项目失败：{e}"))?;
    temporary
        .write_all(&data)
        .map_err(|e| format!("保存项目失败：{e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("保存项目失败：{e}"))?;
    Ok(())
}

pub fn load_project(path: &Path) -> Result<Project, String> {
    let data = fs::read(path).map_err(|e| format!("打开项目失败：{e}"))?;
    let book: Project =
        serde_json::from_slice(&data).map_err(|e| format!("项目文件格式错误：{e}"))?;
    validate_project(&book)?;
    Ok(book)
}

pub fn validate_project(book: &Project) -> Result<(), String> {
    if book.version != 1 {
        return Err("不支持的项目文件版本".into());
    }
    if book.chapters.is_empty() {
        return Err("项目没有章节".into());
    }
    if book.title.trim().is_empty() {
        return Err("请输入书名".into());
    }
    Ok(())
}

pub fn read_image(path: &Path) -> Result<String, String> {
    let mime = match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => return Err("仅支持 PNG、JPEG、GIF、WebP、SVG 图片".into()),
    };
    let data = fs::read(path).map_err(|e| format!("读取图片失败：{e}"))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(data)))
}

pub fn download_image(url: &str) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅支持 HTTP 或 HTTPS 图片链接".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(url).send().map_err(|e| format!("下载图片失败：{e}"))?
        .error_for_status().map_err(|e| format!("下载图片失败：{e}"))?;
    let mut bytes = Vec::new();
    response.by_ref().take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("读取图片失败：{e}"))?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("图片超过 8 MB".into()); }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { "image/gif" }
        else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { "image/webp" }
        else { return Err("链接返回的内容不是受支持的图片".into()); };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

struct ImageAsset {
    name: String,
    media_type: String,
    bytes: Vec<u8>,
}

fn add_image(data_uri: &str, assets: &mut Vec<ImageAsset>) -> Result<String, String> {
    let (header, encoded) = data_uri.split_once(',').ok_or("图片数据无效")?;
    let (media_type, ext) = match header {
        "data:image/png;base64" => ("image/png", "png"),
        "data:image/jpeg;base64" => ("image/jpeg", "jpg"),
        "data:image/gif;base64" => ("image/gif", "gif"),
        "data:image/webp;base64" => ("image/webp", "webp"),
        "data:image/svg+xml;base64" => ("image/svg+xml", "svg"),
        _ => return Err("图片格式不支持".into()),
    };
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|e| format!("图片编码错误：{e}"))?;
    if let Some(existing) = assets
        .iter()
        .find(|asset| asset.media_type == media_type && asset.bytes == bytes)
    {
        return Ok(existing.name.clone());
    }
    let name = format!("image-{}.{}", assets.len() + 1, ext);
    assets.push(ImageAsset {
        name: name.clone(),
        media_type: media_type.into(),
        bytes,
    });
    Ok(name)
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn reads_webp_as_cover_data_uri() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.webp");
        fs::write(&path, b"RIFF\x04\0\0\0WEBP").unwrap();
        assert_eq!(read_image(&path).unwrap(), "data:image/webp;base64,UklGRgQAAABXRUJQ");
    }

    #[test]
    fn embeds_webp_images_in_epub_assets() {
        let mut assets = Vec::new();
        let html = embed_inline_images("<p><img src=\"data:image/webp;base64,UklGRgAAAABXRUJQ\" alt=\"图\" /></p>", &mut assets).unwrap();
        assert_eq!(html, "<p><img src=\"../images/image-1.webp\" alt=\"图\" /></p>");
        assert_eq!(assets[0].media_type, "image/webp");
    }
}

fn embed_inline_images(html: &str, assets: &mut Vec<ImageAsset>) -> Result<String, String> {
    let image_tag = Regex::new(r"(?i)<img\b[^>]*>").unwrap();
    let src_attr = Regex::new(r#"(?i)\bsrc=["']([^"']+)["']"#).unwrap();
    let alt_attr = Regex::new(r#"(?i)\balt=["']([^"']*)["']"#).unwrap();
    let mut output = String::new();
    let mut end = 0;
    for found in image_tag.find_iter(html) {
        output.push_str(&html[end..found.start()]);
        let tag = found.as_str();
        if let Some(src) = src_attr.captures(tag).and_then(|c| c.get(1)) {
            let name = add_image(src.as_str(), assets)?;
            let alt = alt_attr
                .captures(tag)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str())
                .unwrap_or("");
            output.push_str(&format!(
                "<img src=\"../images/{name}\" alt=\"{}\" />",
                escape_xml(alt)
            ));
        }
        end = found.end();
    }
    output.push_str(&html[end..]);
    let void_tags = Regex::new(r"(?i)<(br|hr)\s*/?>").unwrap();
    Ok(void_tags
        .replace_all(&output, "<$1/>")
        .replace("&nbsp;", "&#160;"))
}

fn css_font(value: &str, fonts: &[EmbeddedFont]) -> String {
    if fonts
        .iter()
        .any(|font| font.family == value && valid_font_family(value))
    {
        return format!("'{value}',serif");
    }
    match value {
        "sans-serif" => "sans-serif",
        "monospace" => "monospace",
        "Noto Serif CJK SC" => "'Noto Serif CJK SC',serif",
        "Noto Sans CJK SC" => "'Noto Sans CJK SC',sans-serif",
        "Songti SC" => "'Songti SC',serif",
        "PingFang SC" => "'PingFang SC',sans-serif",
        "Georgia" => "Georgia,serif",
        _ => "serif",
    }
    .into()
}

fn valid_font_family(value: &str) -> bool {
    value.starts_with("EPUBStudioFont")
        && value[14..].chars().all(|c| c.is_ascii_digit())
        && value.len() > 14
}

fn font_format(mime: &str) -> Option<&'static str> {
    match mime {
        "font/ttf" => Some("ttf"),
        "font/otf" => Some("otf"),
        "font/woff" => Some("woff"),
        "font/woff2" => Some("woff2"),
        _ => None,
    }
}

fn css_align(value: &str) -> &'static str {
    match value {
        "left" => "left",
        "center" => "center",
        "right" => "right",
        _ => "justify",
    }
}

fn style_css(style: &BookStyle, fonts: &[EmbeddedFont]) -> String {
    let mut faces = String::new();
    for (index, font) in fonts.iter().enumerate() {
        if let Some(ext) = font_format(&font.mime)
            && valid_font_family(&font.family)
        {
            faces.push_str(&format!(
                "@font-face{{font-family:'{}';src:url('../fonts/font-{}.{}')}}",
                font.family,
                index + 1,
                ext
            ));
        }
    }
    format!(
        "{faces}body{{font-family:{};font-size:{}px;line-height:{:.2};text-align:{};margin:0 auto;max-width:42em;padding:1.5em;color:#20302e}}h1{{font-family:{};font-size:{}px;text-align:{};line-height:1.35;margin:1.2em 0}}p{{margin:0 0 .9em{}}}img{{max-width:100%;height:auto}}.chapter-image{{text-align:center;margin:1.5em 0}}",
        css_font(&style.body_font_family, fonts),
        style.body_font_size.clamp(10, 48),
        style.body_line_height.clamp(1.2, 3.0),
        css_align(&style.body_align),
        css_font(&style.title_font_family, fonts),
        style.title_font_size.clamp(16, 72),
        css_align(&style.title_align),
        if style.body_first_line_indent { ";text-indent:2em" } else { "" }
    )
}

fn resolve_style(base: &BookStyle, overrides: &VolumeStyle) -> BookStyle {
    BookStyle {
        title_font_family: overrides
            .title_font_family
            .clone()
            .unwrap_or_else(|| base.title_font_family.clone()),
        title_font_size: overrides.title_font_size.unwrap_or(base.title_font_size),
        title_align: overrides
            .title_align
            .clone()
            .unwrap_or_else(|| base.title_align.clone()),
        body_font_family: overrides
            .body_font_family
            .clone()
            .unwrap_or_else(|| base.body_font_family.clone()),
        body_font_size: overrides.body_font_size.unwrap_or(base.body_font_size),
        body_line_height: overrides.body_line_height.unwrap_or(base.body_line_height),
        body_align: overrides
            .body_align
            .clone()
            .unwrap_or_else(|| base.body_align.clone()),
        body_first_line_indent: base.body_first_line_indent,
    }
}

/// Per-volume typography overrides, applied to a volume page and its chapters.
fn volume_css(book: &Project) -> String {
    let mut css = String::new();
    for (index, volume) in book.volumes.iter().enumerate() {
        let n = index + 1;
        let style = resolve_style(&book.style, &volume.style);
        css.push_str(&format!(
            "body.volume-{n}{{font-family:{};font-size:{}px;line-height:{:.2};text-align:{}}}body.volume-{n} h1{{font-family:{};font-size:{}px;text-align:{}}}",
            css_font(&style.body_font_family, &book.font_assets),
            style.body_font_size.clamp(10, 48),
            style.body_line_height.clamp(1.2, 3.0),
            css_align(&style.body_align),
            css_font(&style.title_font_family, &book.font_assets),
            style.title_font_size.clamp(16, 72),
            css_align(&style.title_align)
        ));
    }
    css
}

fn chapter_volume_index(book: &Project, chapter: &EditableChapter) -> Option<usize> {
    chapter
        .volume_id
        .as_ref()
        .and_then(|id| book.volumes.iter().position(|volume| &volume.id == id))
}

pub fn export_epub(book: &Project, path: &Path) -> Result<(), String> {
    validate_project(book)?;
    let parent = path.parent().unwrap_or(Path::new("."));
    let temporary = NamedTempFile::new_in(parent).map_err(|e| format!("创建 EPUB 失败：{e}"))?;
    let mut zip = ZipWriter::new(temporary);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let compressed = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    write_zip(&mut zip, "mimetype", b"application/epub+zip", stored)?;
    write_zip(&mut zip, "META-INF/container.xml", br#"<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#, compressed)?;
    let mut css = style_css(&book.style, &book.font_assets);
    css.push_str(&volume_css(book));
    write_zip(
        &mut zip,
        "OEBPS/styles/book.css",
        css.as_bytes(),
        compressed,
    )?;
    let mut assets = Vec::new();
    let cover_name = book
        .cover_image
        .as_ref()
        .map(|image| add_image(image, &mut assets))
        .transpose()?;
    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/><item id=\"css\" href=\"styles/book.css\" media-type=\"text/css\"/>",
    );
    for (index, font) in book.font_assets.iter().enumerate() {
        let ext = font_format(&font.mime).ok_or("字体格式不支持")?;
        if !valid_font_family(&font.family) {
            return Err("字体标识无效".into());
        }
        let (header, encoded) = font.data_uri.split_once(',').ok_or("字体数据无效")?;
        if header != format!("data:{};base64", font.mime) {
            return Err("字体数据格式无效".into());
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|e| format!("字体编码错误：{e}"))?;
        let name = format!("font-{}.{}", index + 1, ext);
        manifest.push_str(&format!(
            "<item id=\"font-{}\" href=\"fonts/{name}\" media-type=\"{}\"/>",
            index + 1,
            font.mime
        ));
        write_zip(&mut zip, &format!("OEBPS/fonts/{name}"), &bytes, compressed)?;
    }
    let mut spine = String::new();
    let mut links = String::new();
    let mut open_volume: Option<usize> = None;
    for (index, chapter) in book.chapters.iter().enumerate() {
        let n = index + 1;
        let href = format!("text/chapter-{n}.xhtml");
        let volume_index = chapter_volume_index(book, chapter);
        if volume_index != open_volume {
            if open_volume.is_some() {
                links.push_str("</ol></li>");
            }
            open_volume = volume_index;
            if let Some(vi) = volume_index {
                let volume = &book.volumes[vi];
                let vn = vi + 1;
                let volume_href = format!("text/volume-{vn}.xhtml");
                manifest.push_str(&format!(
                    "<item id=\"volume-{vn}\" href=\"{volume_href}\" media-type=\"application/xhtml+xml\"/>"
                ));
                spine.push_str(&format!("<itemref idref=\"volume-{vn}\"/>"));
                let mut body = format!("<h1>{}</h1>", escape_xml(&volume.title));
                if let Some(image) = &volume.opening_image {
                    let name = add_image(image, &mut assets)?;
                    body.push_str(&format!("<figure class=\"chapter-image\"><img src=\"../images/{name}\" alt=\"卷首图片\" /></figure>"));
                }
                let document = xhtml(
                    &volume.title,
                    &body,
                    Some("../styles/book.css"),
                    Some(&format!("volume-{vn}")),
                );
                write_zip(
                    &mut zip,
                    &format!("OEBPS/{volume_href}"),
                    document.as_bytes(),
                    compressed,
                )?;
                links.push_str(&format!(
                    "<li><a href=\"{volume_href}\">{}</a><ol>",
                    escape_xml(&volume.title)
                ));
            }
        }
        let volume_class = volume_index.map(|vi| format!("volume-{}", vi + 1));
        manifest.push_str(&format!(
            "<item id=\"chapter-{n}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>"
        ));
        spine.push_str(&format!("<itemref idref=\"chapter-{n}\"/>"));
        links.push_str(&format!(
            "<li><a href=\"{href}\">{}</a></li>",
            escape_xml(&chapter.title)
        ));
        let title_id = chapter
            .title_id
            .as_ref()
            .map(|id| format!(" id=\"{}\"", escape_xml(id)))
            .unwrap_or_default();
        let mut body = format!("<h1{title_id}>{}</h1>", escape_xml(&chapter.title));
        if let Some(image) = &book.opening_image {
            let name = add_image(image, &mut assets)?;
            body.push_str(&format!("<figure class=\"chapter-image\"><img src=\"../images/{name}\" alt=\"章节开头图片\" /></figure>"));
        }
        body.push_str(&embed_inline_images(&chapter.html, &mut assets)?);
        if let Some(image) = &book.closing_image {
            let name = add_image(image, &mut assets)?;
            body.push_str(&format!("<figure class=\"chapter-image\"><img src=\"../images/{name}\" alt=\"章节末尾图片\" /></figure>"));
        }
        // A volume's closing image belongs after the last chapter of that volume.
        if let Some(vi) = volume_index {
            let next_volume = book
                .chapters
                .get(index + 1)
                .and_then(|next| chapter_volume_index(book, next));
            if next_volume != Some(vi)
                && let Some(image) = &book.volumes[vi].closing_image
            {
                let name = add_image(image, &mut assets)?;
                body.push_str(&format!("<figure class=\"chapter-image\"><img src=\"../images/{name}\" alt=\"卷尾图片\" /></figure>"));
            }
        }
        let document = xhtml(
            &chapter.title,
            &body,
            Some("../styles/book.css"),
            volume_class.as_deref(),
        );
        write_zip(
            &mut zip,
            &format!("OEBPS/{href}"),
            document.as_bytes(),
            compressed,
        )?;
    }
    if open_volume.is_some() {
        links.push_str("</ol></li>");
    }
    for (index, asset) in assets.iter().enumerate() {
        let properties = if cover_name.as_deref() == Some(&asset.name) {
            " properties=\"cover-image\""
        } else {
            ""
        };
        manifest.push_str(&format!(
            "<item id=\"image-{}\" href=\"images/{}\" media-type=\"{}\"{properties}/>",
            index + 1,
            asset.name,
            asset.media_type
        ));
        write_zip(
            &mut zip,
            &format!("OEBPS/images/{}", asset.name),
            &asset.bytes,
            compressed,
        )?;
    }
    let nav = format!("<nav epub:type=\"toc\" id=\"toc\"><h1>目录</h1><ol>{links}</ol></nav>");
    write_zip(
        &mut zip,
        "OEBPS/nav.xhtml",
        xhtml("目录", &nav, Some("styles/book.css"), None).as_bytes(),
        compressed,
    )?;
    let modified = OffsetDateTime::now_utc()
        .format(format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second]Z"
        ))
        .map_err(|e| e.to_string())?;
    let opf = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">urn:epubstudio:{:016x}</dc:identifier><dc:title>{}</dc:title><dc:creator>{}</dc:creator><dc:language>{}</dc:language><meta property=\"dcterms:modified\">{modified}</meta></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>",
        book_id(book),
        escape_xml(&book.title),
        escape_xml(&book.author),
        escape_xml(&book.language)
    );
    write_zip(&mut zip, "OEBPS/content.opf", opf.as_bytes(), compressed)?;
    let temporary = zip.finish().map_err(|e| format!("完成 EPUB 失败：{e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("保存 EPUB 失败：{e}"))?;
    Ok(())
}

fn write_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    path: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(path, options).map_err(|e| e.to_string())?;
    zip.write_all(bytes).map_err(|e| e.to_string())
}

fn xhtml(title: &str, body: &str, css: Option<&str>, body_class: Option<&str>) -> String {
    let stylesheet = css
        .map(|path| format!("<link rel=\"stylesheet\" type=\"text/css\" href=\"{path}\"/>"))
        .unwrap_or_default();
    let class = body_class
        .map(|value| format!(" class=\"{}\"", escape_xml(value)))
        .unwrap_or_default();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>{}</title>{stylesheet}</head><body{class}>{body}</body></html>",
        escape_xml(title)
    )
}

fn book_id(book: &Project) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in book.title.bytes().chain(book.author.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn escape_xml(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\u{0}'..='\u{8}' | '\u{b}'..='\u{c}' | '\u{e}'..='\u{1f}' => {}
            _ => out.push(c),
        }
    }
    out
}

fn import_epub(path: &Path) -> Result<Project, String> {
    let file = fs::File::open(path).map_err(|e| format!("打开 EPUB 失败：{e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("EPUB 文件无效：{e}"))?;
    let container = zip_text(&mut archive, "META-INF/container.xml")?;
    let container_doc =
        Document::parse(&container).map_err(|e| format!("container.xml 无效：{e}"))?;
    let opf_path = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("EPUB 未指定内容文件")?
        .to_string();
    let opf = zip_text(&mut archive, &opf_path)?;
    let opf_doc = Document::parse(&opf).map_err(|e| format!("EPUB 内容文件无效：{e}"))?;
    let metadata = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("metadata"))
        .ok_or("EPUB 缺少元数据")?;
    let metadata_value = |name: &str| -> Option<String> {
        metadata
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == name)
            .and_then(|n| n.text())
            .map(str::to_string)
    };
    let title = metadata_value("title").unwrap_or_else(|| {
        path.file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let author = metadata_value("creator").unwrap_or_else(|| "未知作者".into());
    let language = metadata_value("language").unwrap_or_else(|| "zh-CN".into());
    let manifest_node = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("manifest"))
        .ok_or("EPUB 缺少资源列表")?;
    let manifest: HashMap<String, (String, String)> = manifest_node
        .children()
        .filter(|n| n.has_tag_name("item"))
        .filter_map(|n| {
            Some((
                n.attribute("id")?.to_string(),
                (
                    n.attribute("href")?.to_string(),
                    n.attribute("properties").unwrap_or("").to_string(),
                ),
            ))
        })
        .collect();
    let cover_id = manifest
        .iter()
        .find(|(_, (_, properties))| {
            properties
                .split_whitespace()
                .any(|part| part == "cover-image")
        })
        .map(|(id, _)| id.as_str())
        .or_else(|| {
            opf_doc
                .descendants()
                .find(|node| node.has_tag_name("meta") && node.attribute("name") == Some("cover"))
                .and_then(|node| node.attribute("content"))
        });
    let cover_image = cover_id
        .and_then(|id| manifest.get(id))
        .and_then(|(href, _)| resolve_zip_path(&opf_path, href).ok())
        .and_then(|path| {
            let mime = image_mime(&path)?;
            let mut bytes = Vec::new();
            archive.by_name(&path).ok()?.read_to_end(&mut bytes).ok()?;
            Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
        });
    let spine = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("spine"))
        .ok_or("EPUB 缺少阅读顺序")?;
    let mut drafts: Vec<ImportedChapter> = Vec::new();
    for item in spine.children().filter(|n| n.has_tag_name("itemref")) {
        let Some(id) = item.attribute("idref") else {
            continue;
        };
        let Some((href, properties)) = manifest.get(id) else {
            continue;
        };
        if properties.split_whitespace().any(|p| p == "nav") {
            continue;
        }
        let chapter_path = resolve_zip_path(&opf_path, href)?;
        let source = zip_text(&mut archive, &chapter_path)?;
        let doc =
            Document::parse(&source).map_err(|e| format!("章节 {} 无效：{e}", chapter_path))?;
        let body = doc
            .descendants()
            .find(|n| n.has_tag_name("body"))
            .ok_or("章节缺少正文")?;
        let mut blocks = Vec::new();
        for child in body.children() {
            flatten_blocks(child, &mut blocks);
        }
        let split_tag = if blocks.iter().any(|n| n.has_tag_name("h1")) {
            "h1"
        } else {
            "h2"
        };
        let mut title = format!("章节 {}", drafts.len() + 1);
        let mut title_id = None;
        let mut html = String::new();
        let mut anchors = Vec::new();
        let mut started = false;
        for block in blocks {
            if block.has_tag_name(split_tag) {
                if started {
                    drafts.push(ImportedChapter {
                        title: std::mem::take(&mut title),
                        title_id: title_id.take(),
                        html: std::mem::take(&mut html),
                        anchors: std::mem::take(&mut anchors),
                        source_path: chapter_path.clone(),
                    });
                }
                title = node_text(block).trim().to_string();
                if title.is_empty() {
                    title = format!("章节 {}", drafts.len() + 1);
                }
                title_id = block.attribute("id").map(str::to_string);
                if let Some(id) = &title_id {
                    anchors.push(id.clone());
                }
                started = true;
            } else {
                for node in block.descendants() {
                    if node.is_element()
                        && supports_id(node.tag_name().name())
                        && let Some(id) = node.attribute("id")
                    {
                        anchors.push(id.to_string());
                    }
                }
                let content = import_node(block, &chapter_path, &mut archive);
                if !content.trim().is_empty() {
                    started = true;
                }
                html.push_str(&content);
            }
        }
        if started {
            drafts.push(ImportedChapter {
                title,
                title_id,
                html,
                anchors,
                source_path: chapter_path,
            });
        }
    }
    if drafts.is_empty() {
        return Err("EPUB 没有可编辑章节".into());
    }
    let mut first_by_source = HashMap::new();
    let mut by_anchor = HashMap::new();
    for (index, draft) in drafts.iter().enumerate() {
        first_by_source
            .entry(draft.source_path.clone())
            .or_insert(index);
        for anchor in &draft.anchors {
            by_anchor.insert((draft.source_path.clone(), anchor.clone()), index);
        }
    }
    let chapters = drafts
        .into_iter()
        .enumerate()
        .map(|(index, mut draft)| {
            draft.html = rewrite_links(
                &draft.html,
                &draft.source_path,
                index,
                &first_by_source,
                &by_anchor,
            );
            EditableChapter {
                id: format!("chapter-{}", index + 1),
                title: draft.title,
                title_id: draft.title_id,
                volume_id: None,
                html: draft.html,
            }
        })
        .collect();
    Ok(Project {
        version: 1,
        title,
        author,
        language,
        style: BookStyle::default(),
        cover_image,
        opening_image: None,
        closing_image: None,
        font_assets: Vec::new(),
        volumes: Vec::new(),
        chapters,
    })
}

fn image_mime(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

struct ImportedChapter {
    title: String,
    title_id: Option<String>,
    html: String,
    anchors: Vec<String>,
    source_path: String,
}

fn flatten_blocks<'a, 'input>(node: Node<'a, 'input>, output: &mut Vec<Node<'a, 'input>>) {
    if node.is_element() && matches!(node.tag_name().name(), "section" | "article" | "div") {
        for child in node.children() {
            flatten_blocks(child, output);
        }
    } else {
        output.push(node);
    }
}

fn supports_id(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "a"
    )
}

fn rewrite_links(
    html: &str,
    source_path: &str,
    current_index: usize,
    first_by_source: &HashMap<String, usize>,
    by_anchor: &HashMap<(String, String), usize>,
) -> String {
    let href = Regex::new(r#"href="([^"]*)""#).unwrap();
    href.replace_all(html, |captures: &regex::Captures<'_>| {
        let original = &captures[1];
        if original.starts_with("https://")
            || original.starts_with("http://")
            || original.starts_with("mailto:")
        {
            return captures[0].to_string();
        }
        let (path, fragment) = original.split_once('#').unwrap_or((original, ""));
        let target_path = if path.is_empty() {
            source_path.to_string()
        } else {
            match resolve_zip_path(source_path, path) {
                Ok(path) => path,
                Err(_) => return captures[0].to_string(),
            }
        };
        let target = if fragment.is_empty() {
            first_by_source.get(&target_path)
        } else {
            by_anchor
                .get(&(target_path.clone(), fragment.to_string()))
                .or_else(|| first_by_source.get(&target_path))
        };
        let Some(&target) = target else {
            return captures[0].to_string();
        };
        let target_href = if target == current_index && !fragment.is_empty() {
            format!("#{fragment}")
        } else if fragment.is_empty() {
            format!("chapter-{}.xhtml", target + 1)
        } else {
            format!("chapter-{}.xhtml#{fragment}", target + 1)
        };
        format!("href=\"{}\"", escape_xml(&target_href))
    })
    .into_owned()
}

fn zip_text(archive: &mut ZipArchive<fs::File>, path: &str) -> Result<String, String> {
    let mut content = String::new();
    archive
        .by_name(path)
        .map_err(|e| format!("EPUB 缺少 {path}：{e}"))?
        .read_to_string(&mut content)
        .map_err(|e| format!("读取 {path} 失败：{e}"))?;
    Ok(content)
}

fn resolve_zip_path(base_file: &str, href: &str) -> Result<String, String> {
    let href = href.split(['#', '?']).next().unwrap_or("");
    let decoded = percent_decode_str(href)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let base = base_file.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    let joined = if base.is_empty() {
        decoded.to_string()
    } else {
        format!("{base}/{decoded}")
    };
    let mut parts = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("EPUB 资源路径超出文件范围".into());
                }
            }
            value => parts.push(value),
        }
    }
    Ok(parts.join("/"))
}

fn node_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter(|n| n.is_text())
        .filter_map(|n| n.text())
        .collect()
}

fn import_node(
    node: Node<'_, '_>,
    chapter_path: &str,
    archive: &mut ZipArchive<fs::File>,
) -> String {
    if node.is_text() {
        return escape_xml(node.text().unwrap_or(""));
    }
    if !node.is_element() {
        return String::new();
    }
    let tag = node.tag_name().name();
    if tag == "img" {
        let Some(src) = node.attribute("src") else {
            return String::new();
        };
        let Ok(path) = resolve_zip_path(chapter_path, src) else {
            return String::new();
        };
        let Ok(mut image) = archive.by_name(&path) else {
            return String::new();
        };
        let mut bytes = Vec::new();
        if image.read_to_end(&mut bytes).is_err() {
            return String::new();
        }
        let mime = match path
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            _ => return String::new(),
        };
        return format!(
            "<img src=\"data:{mime};base64,{}\" alt=\"{}\" />",
            STANDARD.encode(bytes),
            escape_xml(node.attribute("alt").unwrap_or(""))
        );
    }
    if tag == "br" {
        return "<br/>".into();
    }
    let children: String = node
        .children()
        .map(|child| import_node(child, chapter_path, archive))
        .collect();
    let id = if supports_id(tag) {
        node.attribute("id")
            .map(|value| format!(" id=\"{}\"", escape_xml(value)))
            .unwrap_or_default()
    } else {
        String::new()
    };
    if tag == "a" {
        let href = node.attribute("href").unwrap_or("");
        if href.to_ascii_lowercase().starts_with("javascript:") || href.starts_with("//") {
            return children;
        }
        return format!("<a{id} href=\"{}\">{children}</a>", escape_xml(href));
    }
    let allowed = matches!(
        tag,
        "p" | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "strong"
            | "b"
            | "em"
            | "i"
            | "u"
            | "s"
            | "span"
            | "ul"
            | "ol"
            | "li"
            | "blockquote"
            | "pre"
            | "code"
            | "figure"
    );
    if !allowed {
        return children;
    }
    let safe_tag = match tag {
        "b" => "strong",
        "i" => "em",
        other => other,
    };
    let style = safe_inline_style(node.attribute("style").unwrap_or(""));
    let attr = if style.is_empty() {
        String::new()
    } else {
        format!(" style=\"{}\"", escape_xml(&style))
    };
    format!("<{safe_tag}{id}{attr}>{children}</{safe_tag}>")
}

fn safe_inline_style(style: &str) -> String {
    style
        .split(';')
        .filter_map(|rule| {
            let (key, value) = rule.split_once(':')?;
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            if !matches!(
                key.as_str(),
                "font-size"
                    | "font-family"
                    | "font-weight"
                    | "font-style"
                    | "text-align"
                    | "color"
                    | "background-color"
                    | "line-height"
                    | "text-decoration"
            ) {
                return None;
            }
            if value.len() > 80
                || !value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "#%.,() '-\"".contains(c))
            {
                return None;
            }
            if value.to_ascii_lowercase().contains("url") {
                return None;
            }
            Some(format!("{key}:{value}"))
        })
        .collect::<Vec<_>>()
        .join(";")
}
