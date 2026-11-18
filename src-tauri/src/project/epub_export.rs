use base64::{Engine, engine::general_purpose::STANDARD};
use regex::Regex;
use std::{
    collections::{HashMap, HashSet},
    io::{Seek, Write},
    path::Path,
    sync::OnceLock,
};
use tempfile::NamedTempFile;
use time::{OffsetDateTime, macros::format_description};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use super::{
    BookStyle, ChapterImage, ChapterImagePlacement, ChapterImageScope, ChapterNote,
    EditableChapter, EmbeddedFont, HeadingLineStyle, NoteBoxStyle, Project, TitleLayout, VolumeStyle, escape_xml,
    font_export::{book_characters, smaller_font_subset},
    validate_project,
};

fn chapter_image_applies(chapter: &EditableChapter, entry: &ChapterImage) -> bool {
    match &entry.scope {
        ChapterImageScope::All => true,
        ChapterImageScope::Chapters { ids } => ids.iter().any(|id| id == &chapter.id),
        ChapterImageScope::Volumes { ids } => chapter
            .volume_id
            .as_deref()
            .is_some_and(|volume_id| ids.iter().any(|id| id == volume_id)),
    }
}

fn chapter_image_figure(
    entry: &ChapterImage,
    assets: &mut Vec<ImageAsset>,
) -> Result<String, String> {
    let name = add_image(&entry.image, assets)?;
    let (position, alt) = match entry.placement {
        ChapterImagePlacement::Above => ("above", "章节标题上方图片"),
        ChapterImagePlacement::Below => ("below", "章节标题下方图片"),
    };
    Ok(format!(
        "<figure class=\"chapter-image chapter-image-{position}\"><img src=\"../images/{name}\" alt=\"{alt}\" /></figure>"
    ))
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

fn css_font(value: &str, fonts: &[&EmbeddedFont]) -> String {
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
    ["EPUBStudioFont", "EPUBStudioLibraryFont"]
        .into_iter()
        .filter_map(|prefix| value.strip_prefix(prefix))
        .any(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
}

fn used_fonts(book: &Project) -> Vec<&EmbeddedFont> {
    let style = &book.style;
    let mut families: HashSet<&str> = [
        style.title_font_family.as_str(),
        style.body_font_family.as_str(),
        style.note_font_family.as_str(),
    ]
    .into_iter()
    .collect();
    for line in [
        &style.chapter_number_style,
        &style.chapter_name_style,
        &style.volume_number_style,
        &style.volume_name_style,
    ] {
        if let Some(family) = line.font_family.as_deref() {
            families.insert(family);
        }
    }
    for volume in &book.volumes {
        for family in [
            volume.style.title_font_family.as_deref(),
            volume.style.body_font_family.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            families.insert(family);
        }
    }
    let inline_font = Regex::new(r"EPUBStudio(?:Library)?Font\d+").unwrap();
    for chapter in &book.chapters {
        for found in inline_font.find_iter(&chapter.html) {
            families.insert(found.as_str());
        }
    }
    book.font_assets
        .iter()
        .filter(|font| families.contains(font.family.as_str()))
        .collect()
}

#[cfg(test)]
mod library_font_family_tests {
    use super::valid_font_family;

    #[test]
    fn accepts_distinct_shared_library_font_families() {
        assert!(valid_font_family("EPUBStudioLibraryFont1"));
        assert!(valid_font_family("EPUBStudioFont1"));
        assert!(!valid_font_family("EPUBStudioLibraryFont1;src:url(x)"));
    }
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

fn safe_css_color<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.starts_with('#')
        && (value.len() == 7 || value.len() == 4)
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        value
    } else {
        fallback
    }
}

fn heading_line_css(
    selector: &str,
    line: &HeadingLineStyle,
    style: &BookStyle,
    fonts: &[&EmbeddedFont],
    number: bool,
) -> String {
    let fallback_color = if number { "#587670" } else { "#183e37" };
    format!(
        "{selector}{{font-family:{};font-size:{}px;color:{};text-align:{};font-weight:{}}}",
        css_font(
            line.font_family
                .as_deref()
                .unwrap_or(&style.title_font_family),
            fonts
        ),
        line.font_size
            .unwrap_or(if number {
                ((style.title_font_size as f32) * 0.65).round() as u16
            } else {
                style.title_font_size
            })
            .clamp(12, 72),
        safe_css_color(
            line.color.as_deref().unwrap_or(fallback_color),
            fallback_color
        ),
        css_align(line.align.as_deref().unwrap_or(&style.title_align)),
        line.weight
            .unwrap_or(if number { 650 } else { 700 })
            .clamp(100, 900),
    )
}

fn heading_styles(style: &BookStyle, fonts: &[&EmbeddedFont], prefix: &str) -> String {
    let mut css = String::new();
    for (kind, part, line, number) in [
        ("chapter", "number", &style.chapter_number_style, true),
        ("chapter", "name", &style.chapter_name_style, false),
        ("volume", "number", &style.volume_number_style, true),
        ("volume", "name", &style.volume_name_style, false),
    ] {
        css.push_str(&heading_line_css(
            &format!("{prefix}.{kind}-heading .heading-{part}"),
            line,
            style,
            fonts,
            number,
        ));
    }
    for (kind, line) in [
        ("chapter", &style.chapter_name_style),
        ("volume", &style.volume_name_style),
    ] {
        css.push_str(&format!(
            "{prefix}.{kind}-heading.title-inline{{text-align:{}}}",
            css_align(line.align.as_deref().unwrap_or(&style.title_align))
        ));
    }
    css
}

fn split_heading(title: &str, volume: bool) -> (String, String) {
    static CHAPTER: OnceLock<Regex> = OnceLock::new();
    static VOLUME: OnceLock<Regex> = OnceLock::new();
    let pattern = if volume {
        VOLUME.get_or_init(|| Regex::new(r"^(第[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬]+[卷部篇]|卷[丨|:：,，、.．·\-—\s]*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬]+[丨|]?)(.*)$").unwrap())
    } else {
        CHAPTER.get_or_init(|| {
            Regex::new(r"^(第[\s　]*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬]+[\s　]*[章节回话])(.*)$").unwrap()
        })
    };
    let text = title.trim();
    if let Some(captures) = pattern.captures(text) {
        let name = captures[2]
            .trim_start_matches(|c: char| c.is_whitespace() || ":：、.．·—-丨|".contains(c))
            .trim();
        (captures[1].to_string(), name.to_string())
    } else {
        (String::new(), text.to_string())
    }
}

fn heading_html(title: &str, volume: bool, id: Option<&str>, layout: TitleLayout) -> String {
    let kind = if volume { "volume" } else { "chapter" };
    let layout_class = if layout == TitleLayout::Inline {
        "title-inline"
    } else {
        "title-stacked"
    };
    let id = id
        .map(|value| format!(" id=\"{}\"", escape_xml(value)))
        .unwrap_or_default();
    let (number, name) = split_heading(title, volume);
    let mut html = format!("<h1 class=\"{kind}-heading {layout_class}\"{id}>");
    if !number.is_empty() {
        html.push_str(&format!(
            "<span class=\"heading-number\">{}</span>",
            escape_xml(&number)
        ));
    }
    if !name.is_empty() {
        html.push_str(&format!(
            "<span class=\"heading-name\">{}</span>",
            escape_xml(&name)
        ));
    }
    html.push_str("</h1>");
    html
}

/// Draws the tip box from the book's configurable style. A zero-width (or
/// `none`) border leaves a frameless box, and a background image may replace
/// the plain fill.
fn note_box_css(style: &NoteBoxStyle, background: Option<&str>) -> String {
    let width = style.border_width.clamp(0.0, 8.0);
    let style_name = match style.border_style.as_str() {
        "dashed" | "dotted" | "double" | "none" => style.border_style.as_str(),
        _ => "solid",
    };
    let border = if width <= 0.0 || style_name == "none" {
        "none".to_string()
    } else {
        format!(
            "{width}px {style_name} {}",
            safe_css_color(&style.border_color, "#b38971")
        )
    };
    let radius = style.corner_radius.min(60);
    let mut fill = if style.background_color.trim().is_empty() {
        String::new()
    } else {
        format!(
            "background-color:{};",
            safe_css_color(&style.background_color, "transparent")
        )
    };
    if let Some(name) = background {
        let size = match style.background_size.as_str() {
            "contain" | "auto" | "100% 100%" => style.background_size.as_str(),
            _ => "cover",
        };
        fill.push_str(&format!(
            "background-image:url('../images/{name}');background-size:{size};background-position:center;background-repeat:no-repeat;"
        ));
    }
    format!(
        ".note-box{{position:relative;margin:2.1em 0 2em;padding:1.5em 1.2em .9em;border:{border};border-radius:0 {radius}px 0 {radius}px;{fill}color:{};line-height:1.65;text-align:left}}.note-box .note-box-title{{display:{};position:relative;min-width:4.5em;margin:-2.35em 0 1em .2em;padding:.1em .65em;border-radius:18px;background:{};color:{};text-align:center;font-weight:bold;line-height:1.5;text-indent:0}}.note-box p{{margin:0 0 .55em;text-indent:0}}.note-box p:last-child{{margin-bottom:0}}.note-box img{{display:inline-block;max-width:1em;max-height:1em;vertical-align:middle;margin:0 .2em 0 0}}",
        safe_css_color(&style.text_color, "#a8795f"),
        if style.show_title { "table" } else { "none" },
        safe_css_color(if style.title_background == style.border_color { "#ffffff" } else { &style.title_background }, "#ffffff"),
        safe_css_color(&style.border_color, "#b38971"),
    )
}

fn style_css(style: &BookStyle, fonts: &[&EmbeddedFont], note_box_background: Option<&str>, chapter_background: Option<&str>, chapter_number_background: Option<&str>, chapter_name_background: Option<&str>) -> String {
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
    let mut css = format!(
        "{faces}body{{font-family:{};font-size:{}px;line-height:{:.2};text-align:{};margin:0 auto;max-width:42em;padding:1.5em;color:#20302e}}h1{{font-family:{};font-size:{}px;text-align:{};line-height:1.35;margin:1.2em 0}}p{{margin:0 0 {:.2}em{}}}.chapter-heading{{margin-bottom:{}px}}img{{display:block;margin:1.2em auto;max-width:100%;height:auto}}.chapter-image{{text-align:center;margin:1.5em 0}}.chapter-image img{{margin:0 auto}}",
        css_font(&style.body_font_family, fonts),
        style.body_font_size.clamp(10, 48),
        style.body_line_height.clamp(1.2, 3.0),
        css_align(&style.body_align),
        css_font(&style.title_font_family, fonts),
        style.title_font_size.clamp(16, 72),
        css_align(&style.title_align),
        style.body_paragraph_spacing.clamp(0.0, 3.0),
        if style.body_first_line_indent {
            ";text-indent:2em"
        } else {
            ""
        },
        style.chapter_body_spacing.clamp(0, 160),
    );
    css.push_str(&format!(
        ".note-marker{{font-size:{}px;color:{};vertical-align:super;line-height:0;text-decoration:none}}.chapter-notes{{font-family:{};font-size:{}px;color:{};text-align:left;line-height:1.6;border-top:1px solid #dce7e4;margin-top:2em;padding-top:1em}}.chapter-notes h2{{font:inherit;font-weight:bold;margin:0 0 .7em}}.chapter-notes p{{margin:0 0 .6em;text-indent:0}}",
        style.note_marker_size.clamp(8, 32),
        safe_css_color(&style.note_marker_color, "#0b8578"),
        css_font(&style.note_font_family, fonts),
        style.note_font_size.clamp(10, 32),
        safe_css_color(&style.note_color, "#526963"),
    ));
    css.push_str(&format!(
        ".note-marker img{{display:inline-block;width:{}px;height:{}px;object-fit:contain;vertical-align:super;margin:0}}.chapter-notes .note-detail-image{{display:inline-block;width:{}px;height:{}px;object-fit:contain;vertical-align:middle;margin:0 .22em 0 0}}",
        style.note_marker_size.clamp(8, 32),
        style.note_marker_size.clamp(8, 32),
        style.note_detail_image_size.clamp(8, 32),
        style.note_detail_image_size.clamp(8, 32),
    ));
    css.push_str(&note_box_css(&style.note_box, note_box_background));
    if let Some(name) = chapter_background {
        let size = match style.chapter_background_size.as_str() {
            "contain" | "100% 100%" | "100% auto" => style.chapter_background_size.as_str(),
            _ => "cover",
        };
        css.push_str(&format!("body.chapter-page{{background-image:url('../images/{name}');background-size:{size};background-repeat:no-repeat;background-position:center top}}"));
    }
    if let Some(name) = chapter_number_background {
        let size = match style.chapter_number_background_size.as_str() {
            "contain" | "cover" | "100% 100%" => style.chapter_number_background_size.as_str(),
            _ => "50% 70%",
        };
        css.push_str(&format!(".chapter-heading .heading-number{{background-image:url('../images/{name}');background-size:{size};background-position:center;background-repeat:no-repeat;padding:1.3em 0 1.7em}}"));
    }
    if let Some(name) = chapter_name_background {
        let size = match style.chapter_name_background_size.as_str() {
            "cover" | "50% 70%" | "100% 100%" => style.chapter_name_background_size.as_str(),
            _ => "contain",
        };
        css.push_str(&format!(".chapter-heading .heading-name{{background-image:url('../images/{name}');background-size:{size};background-position:center;background-repeat:no-repeat;padding:1em 0}}"));
    }
    css.push_str(".chapter-heading .heading-number,.chapter-heading .heading-name,.volume-heading .heading-number,.volume-heading .heading-name{display:block}.chapter-heading .heading-number+.heading-name,.volume-heading .heading-number+.heading-name{margin-top:.35em}");
    css.push_str(".chapter-heading.title-inline .heading-number,.chapter-heading.title-inline .heading-name,.volume-heading.title-inline .heading-number,.volume-heading.title-inline .heading-name{display:inline}.chapter-heading.title-inline .heading-number+.heading-name,.volume-heading.title-inline .heading-number+.heading-name{margin-top:0;margin-left:.35em}");
    css.push_str(&heading_styles(style, fonts, ""));
    if chapter_number_background.is_some() || chapter_name_background.is_some() {
        css.push_str(".chapter-heading.title-inline .heading-number,.chapter-heading.title-inline .heading-name{display:block}.chapter-heading.title-inline .heading-name{margin-left:0}");
    }
    css
}

fn render_chapter_notes(
    html: &str,
    notes: &[ChapterNote],
    marker_image: Option<&str>,
    detail_image: Option<&str>,
) -> (String, String) {
    let marker = Regex::new(r#"(?s)<span\b[^>]*\bdata-note-id="([^"]+)"[^>]*>.*?</span>"#).unwrap();
    let by_id: HashMap<&str, &ChapterNote> =
        notes.iter().map(|note| (note.id.as_str(), note)).collect();
    let mut ordered: Vec<&ChapterNote> = Vec::new();
    let body = marker.replace_all(html, |captures: &regex::Captures<'_>| {
        let id = &captures[1];
        let Some(note) = by_id.get(id) else { return String::new() };
        let number = if let Some(index) = ordered.iter().position(|item| item.id == note.id) { index + 1 } else { ordered.push(note); ordered.len() };
        let marker = marker_image.map(|name| format!("<img src=\"../images/{name}\" alt=\"备注 {number}\" />")).unwrap_or_else(|| format!("[{number}]"));
        format!("<a class=\"note-marker\" id=\"note-ref-{}\" href=\"#note-{}\" epub:type=\"noteref\">{marker}</a>", escape_xml(id), escape_xml(id))
    }).into_owned();
    if ordered.is_empty() {
        return (body, String::new());
    }
    let mut end =
        String::from("<section class=\"chapter-notes\" epub:type=\"endnotes\"><h2>备注</h2>");
    for (index, note) in ordered.iter().enumerate() {
        let detail = detail_image
            .map(|name| {
                format!(
                    "<img class=\"note-detail-image\" src=\"../images/{name}\" alt=\"备注 {}\" />",
                    index + 1
                )
            })
            .unwrap_or_else(|| format!("[{}]", index + 1));
        end.push_str(&format!(
            "<p id=\"note-{}\" epub:type=\"endnote\"><a href=\"#note-ref-{}\">{detail}</a> {}</p>",
            escape_xml(&note.id),
            escape_xml(&note.id),
            escape_xml(&note.text)
        ));
    }
    end.push_str("</section>");
    (body, end)
}

fn resolve_style(base: &BookStyle, overrides: &VolumeStyle) -> BookStyle {
    let mut resolved = BookStyle {
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
        body_paragraph_spacing: base.body_paragraph_spacing,
        chapter_body_spacing: base.chapter_body_spacing,
        chapter_background_size: base.chapter_background_size.clone(),
        chapter_number_background_size: base.chapter_number_background_size.clone(),
        chapter_name_background_size: base.chapter_name_background_size.clone(),
        body_align: overrides
            .body_align
            .clone()
            .unwrap_or_else(|| base.body_align.clone()),
        body_first_line_indent: base.body_first_line_indent,
        note_font_family: base.note_font_family.clone(),
        note_font_size: base.note_font_size,
        note_color: base.note_color.clone(),
        note_marker_size: base.note_marker_size,
        note_marker_color: base.note_marker_color.clone(),
        note_detail_image_size: base.note_detail_image_size,
        note_box: base.note_box.clone(),
        chapter_number_style: base.chapter_number_style.clone(),
        chapter_name_style: base.chapter_name_style.clone(),
        volume_number_style: base.volume_number_style.clone(),
        volume_name_style: base.volume_name_style.clone(),
    };
    for line in [
        &mut resolved.chapter_number_style,
        &mut resolved.chapter_name_style,
        &mut resolved.volume_number_style,
        &mut resolved.volume_name_style,
    ] {
        if let Some(font) = &overrides.title_font_family {
            line.font_family = Some(font.clone());
        }
        if let Some(size) = overrides.title_font_size {
            line.font_size = Some(size);
        }
        if let Some(align) = &overrides.title_align {
            line.align = Some(align.clone());
        }
    }
    resolved
}

/// Per-volume typography overrides, applied to a volume page and its chapters.
fn volume_css(book: &Project, fonts: &[&EmbeddedFont]) -> String {
    let mut css = String::new();
    for (index, volume) in book.volumes.iter().enumerate() {
        let n = index + 1;
        let style = resolve_style(&book.style, &volume.style);
        css.push_str(&format!(
            "body.volume-{n}{{font-family:{};font-size:{}px;line-height:{:.2};text-align:{}}}body.volume-{n} h1{{font-family:{};font-size:{}px;text-align:{}}}",
            css_font(&style.body_font_family, fonts),
            style.body_font_size.clamp(10, 48),
            style.body_line_height.clamp(1.2, 3.0),
            css_align(&style.body_align),
            css_font(&style.title_font_family, fonts),
            style.title_font_size.clamp(16, 72),
            css_align(&style.title_align)
        ));
        css.push_str(&heading_styles(&style, fonts, &format!("body.volume-{n} ")));
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
    let fonts = used_fonts(book);
    let mut assets = Vec::new();
    let has_notes = book.chapters.iter().any(|chapter| !chapter.notes.is_empty());
    let marker_image = book
        .note_marker_image
        .as_deref()
        .filter(|_| has_notes)
        .map(|image| add_image(image, &mut assets))
        .transpose()?;
    let detail_image = book
        .note_detail_image
        .as_deref()
        .filter(|_| has_notes)
        .map(|image| add_image(image, &mut assets))
        .transpose()?;
    let cover_name = book
        .cover_image
        .as_ref()
        .map(|image| add_image(image, &mut assets))
        .transpose()?;
    let note_box_background = book
        .style
        .note_box
        .background_image
        .as_deref()
        .map(|image| add_image(image, &mut assets))
        .transpose()?;
    let chapter_background = book.chapter_background_image.as_deref().map(|image| add_image(image, &mut assets)).transpose()?;
    let chapter_number_background = book.chapter_number_background_image.as_deref().map(|image| add_image(image, &mut assets)).transpose()?;
    let chapter_name_background = book.chapter_name_background_image.as_deref().map(|image| add_image(image, &mut assets)).transpose()?;
    let mut css = style_css(&book.style, &fonts, note_box_background.as_deref(), chapter_background.as_deref(), chapter_number_background.as_deref(), chapter_name_background.as_deref());
    css.push_str(&volume_css(book, &fonts));
    write_zip(
        &mut zip,
        "OEBPS/styles/book.css",
        css.as_bytes(),
        compressed,
    )?;
    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/><item id=\"css\" href=\"styles/book.css\" media-type=\"text/css\"/>",
    );
    let characters = if fonts.is_empty() {
        Default::default()
    } else {
        book_characters(book)
    };
    for (index, font) in fonts.iter().enumerate() {
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
        let optimized = smaller_font_subset(&font.mime, &bytes, &characters);
        let output_bytes = optimized.as_deref().unwrap_or(&bytes);
        let name = format!("font-{}.{}", index + 1, ext);
        manifest.push_str(&format!(
            "<item id=\"font-{}\" href=\"fonts/{name}\" media-type=\"{}\"/>",
            index + 1,
            font.mime
        ));
        write_zip(
            &mut zip,
            &format!("OEBPS/fonts/{name}"),
            output_bytes,
            compressed,
        )?;
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
                let mut body = heading_html(&volume.title, true, None, volume.title_layout);
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
        let images: Vec<&ChapterImage> = book
            .chapter_images
            .iter()
            .filter(|entry| chapter_image_applies(chapter, entry))
            .collect();
        let mut body = String::new();
        for entry in images
            .iter()
            .copied()
            .filter(|entry| entry.placement == ChapterImagePlacement::Above)
        {
            body.push_str(&chapter_image_figure(entry, &mut assets)?);
        }
        body.push_str(&heading_html(
            &chapter.title,
            false,
            chapter.title_id.as_deref(),
            chapter.title_layout,
        ));
        for entry in images
            .iter()
            .copied()
            .filter(|entry| entry.placement == ChapterImagePlacement::Below)
        {
            body.push_str(&chapter_image_figure(entry, &mut assets)?);
        }
        let chapter_html = embed_inline_images(&chapter.html, &mut assets)?;
        let (chapter_html, notes_html) = render_chapter_notes(
            &chapter_html,
            &chapter.notes,
            marker_image.as_deref(),
            detail_image.as_deref(),
        );
        body.push_str(&chapter_html);
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
        body.push_str(&notes_html);
        let chapter_class = volume_class.as_ref().map(|class| format!("chapter-page {class}")).unwrap_or_else(|| "chapter-page".into());
        let document = xhtml(
            &chapter.title,
            &body,
            Some("../styles/book.css"),
            Some(&chapter_class),
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

#[cfg(test)]
mod heading_split_tests {
    use super::split_heading;

    #[test]
    fn splits_upper_case_chinese_numbers() {
        assert_eq!(
            split_heading("第壹卷 少年", true),
            ("第壹卷".to_string(), "少年".to_string())
        );
        assert_eq!(
            split_heading("第贰拾叁章 归途", false),
            ("第贰拾叁章".to_string(), "归途".to_string())
        );
        assert_eq!(
            split_heading("卷壹丨风起", true),
            ("卷壹丨".to_string(), "风起".to_string())
        );
        assert_eq!(
            split_heading("卷丨叁丨", true),
            ("卷丨叁丨".to_string(), String::new())
        );
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn embeds_webp_images_in_epub_assets() {
        let mut assets = Vec::new();
        let html = embed_inline_images(
            "<p><img src=\"data:image/webp;base64,UklGRgAAAABXRUJQ\" alt=\"图\" /></p>",
            &mut assets,
        )
        .unwrap();
        assert_eq!(
            html,
            "<p><img src=\"../images/image-1.webp\" alt=\"图\" /></p>"
        );
        assert_eq!(assets[0].media_type, "image/webp");
    }

    #[test]
    fn renders_note_images_in_both_positions_with_numbered_alt_text() {
        let notes = vec![ChapterNote {
            id: "a".into(),
            text: "注释".into(),
        }];
        let (body, details) = render_chapter_notes(
            "<p>正文<span data-note-id=\"a\">[1]</span></p>",
            &notes,
            Some("marker.png"),
            Some("detail.png"),
        );
        assert!(body.contains("<img src=\"../images/marker.png\" alt=\"备注 1\" />"));
        assert!(details.contains(
            "<img class=\"note-detail-image\" src=\"../images/detail.png\" alt=\"备注 1\" />"
        ));
        assert!(details.contains("注释"));

        let (body, details) =
            render_chapter_notes("<span data-note-id=\"a\">[1]</span>", &notes, None, None);
        assert!(body.contains(">[1]</a>"));
        assert!(details.contains(">[1]</a>"));
    }

    #[test]
    fn note_box_css_follows_the_configurable_style() {
        let style = BookStyle::default();
        let css = note_box_css(&style.note_box, None);
        assert!(css.contains("border:1.5px solid #b38971"));
        assert!(css.contains("border-radius:0 22px 0 22px"));
        assert!(!css.contains("background-image"));

        let plain = NoteBoxStyle { border_width: 0.0, ..NoteBoxStyle::default() };
        assert!(note_box_css(&plain, None).contains("border:none"));

        let fancy = NoteBoxStyle {
            border_width: 3.0,
            border_style: "dashed".into(),
            border_color: "#123456".into(),
            corner_radius: 6,
            background_color: "#fff8f0".into(),
            background_size: "contain".into(),
            title_background: "#222222".into(),
            title_color: "#eeeeee".into(),
            text_color: "#333333".into(),
            ..NoteBoxStyle::default()
        };
        let css = note_box_css(&fancy, Some("image-7.png"));
        assert!(css.contains("border:3px dashed #123456"));
        let double = NoteBoxStyle { border_style: "double".into(), ..fancy.clone() };
        assert!(note_box_css(&double, None).contains("border:3px double #123456"));
        assert!(css.contains("color:#123456"));
        let hidden = NoteBoxStyle { show_title: false, ..fancy.clone() };
        assert!(note_box_css(&hidden, None).contains(".note-box .note-box-title{display:none"));
        assert!(css.contains("border-radius:0 6px 0 6px"));
        assert!(css.contains("background-color:#fff8f0"));
        assert!(css.contains("background-image:url('../images/image-7.png')"));
        assert!(css.contains("background-size:contain"));
        assert!(css.contains("background:#222222"));
        assert!(css.contains("color:#333333"));
    }
}
