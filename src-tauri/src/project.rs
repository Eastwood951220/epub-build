use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use tempfile::NamedTempFile;

use crate::txt::{self, ChapterKind};

mod epub_export;
mod epub_import;
mod font_export;
pub use epub_export::export_epub;
use epub_import::import_epub;

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
    /// Images placed at the chapter title; each entry scopes itself to chapters or volumes.
    #[serde(default)]
    pub chapter_images: Vec<ChapterImage>,
    #[serde(default)]
    pub chapter_background_image: Option<String>,
    #[serde(default)]
    pub chapter_number_background_image: Option<String>,
    #[serde(default)]
    pub chapter_name_background_image: Option<String>,
    #[serde(default)]
    pub note_marker_image: Option<String>,
    #[serde(default)]
    pub note_detail_image: Option<String>,
    /// Legacy single opening image, folded into `chapter_images` when a project loads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opening_image: Option<String>,
    /// Retired chapter-end image; old projects still carry it and it is dropped on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    #[serde(default)]
    pub title_layout: TitleLayout,
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
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct BookStyle {
    pub title_font_family: String,
    pub title_font_size: u16,
    pub title_align: String,
    pub body_font_family: String,
    pub body_font_size: u16,
    pub body_line_height: f32,
    pub body_paragraph_spacing: f32,
    pub chapter_body_spacing: u16,
    pub chapter_background_size: String,
    pub chapter_number_background_size: String,
    pub chapter_name_background_size: String,
    pub body_align: String,
    pub body_first_line_indent: bool,
    pub note_font_family: String,
    pub note_font_size: u16,
    pub note_color: String,
    pub note_marker_size: u16,
    pub note_marker_color: String,
    pub note_detail_image_size: u16,
    /// Presentation of the bordered tip box; a zero border hides the frame.
    pub note_box: NoteBoxStyle,
    pub chapter_number_style: HeadingLineStyle,
    pub chapter_name_style: HeadingLineStyle,
    pub volume_number_style: HeadingLineStyle,
    pub volume_name_style: HeadingLineStyle,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct HeadingLineStyle {
    pub font_family: Option<String>,
    pub font_size: Option<u16>,
    pub color: Option<String>,
    pub align: Option<String>,
    pub weight: Option<u16>,
}

/// How a `aside.note-box` tip box is drawn. Not every tip box is a bordered
/// card: a zero border width (or style `none`) drops the frame entirely, and
/// `background_image` allows a decorative frame picture instead of a plain fill.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct NoteBoxStyle {
    pub border_color: String,
    pub border_width: f32,
    pub border_style: String,
    pub corner_radius: u16,
    /// Empty means "let the paper show through".
    pub background_color: String,
    pub background_image: Option<String>,
    pub background_size: String,
    pub title_background: String,
    pub title_color: String,
    pub text_color: String,
}

impl Default for NoteBoxStyle {
    fn default() -> Self {
        Self {
            border_color: "#b38971".into(),
            border_width: 1.5,
            border_style: "solid".into(),
            corner_radius: 22,
            background_color: String::new(),
            background_image: None,
            background_size: "cover".into(),
            title_background: "#b38971".into(),
            title_color: "#ffffff".into(),
            text_color: "#a8795f".into(),
        }
    }
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
            body_paragraph_spacing: 0.9,
            chapter_body_spacing: 46,
            chapter_background_size: "cover".into(),
            chapter_number_background_size: "50% 70%".into(),
            chapter_name_background_size: "contain".into(),
            body_align: "justify".into(),
            body_first_line_indent: false,
            note_font_family: "serif".into(),
            note_font_size: 14,
            note_color: "#526963".into(),
            note_marker_size: 12,
            note_marker_color: "#0b8578".into(),
            note_detail_image_size: 12,
            note_box: NoteBoxStyle::default(),
            chapter_number_style: HeadingLineStyle::default(),
            chapter_name_style: HeadingLineStyle::default(),
            volume_number_style: HeadingLineStyle::default(),
            volume_name_style: HeadingLineStyle::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditableChapter {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub title_layout: TitleLayout,
    #[serde(default)]
    pub title_id: Option<String>,
    #[serde(default)]
    pub volume_id: Option<String>,
    pub html: String,
    #[serde(default)]
    pub notes: Vec<ChapterNote>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChapterNote {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TitleLayout {
    Inline,
    #[default]
    Stacked,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChapterImagePlacement {
    Above,
    #[default]
    Below,
}

/// Which chapters a chapter image applies to.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChapterImageScope {
    /// Every chapter, the default for a newly added image.
    #[default]
    All,
    Chapters {
        ids: Vec<String>,
    },
    Volumes {
        ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterImage {
    pub id: String,
    pub image: String,
    #[serde(default)]
    pub placement: ChapterImagePlacement,
    #[serde(default)]
    pub scope: ChapterImageScope,
}

impl Project {
    /// Folds the retired single-image fields into `chapter_images` so old
    /// projects open and export with the list-based setting.
    pub fn migrate_chapter_images(&mut self) {
        if let Some(image) = self.opening_image.take()
            && self.chapter_images.is_empty()
        {
            self.chapter_images.push(ChapterImage {
                id: "legacy-opening".into(),
                image,
                placement: ChapterImagePlacement::Below,
                scope: ChapterImageScope::All,
            });
        }
        // The per-chapter ending image was removed; old projects drop it on load.
        self.closing_image = None;
    }
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
    let book = txt::parse_book_with_patterns(&text, &title, chapter_pattern, volume_pattern)?;
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
                    title_layout: TitleLayout::Stacked,
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
                        title_layout: TitleLayout::Stacked,
                        title_id: None,
                        volume_id: Some(id),
                        html: paragraphs_html(&chapter.paragraphs),
                        notes: Vec::new(),
                    });
                }
            }
            ChapterKind::Chapter => chapters.push(EditableChapter {
                id: format!("chapter-{}", chapters.len() + 1),
                title: chapter.title,
                title_layout: TitleLayout::Stacked,
                title_id: None,
                volume_id: current_volume.clone(),
                html: paragraphs_html(&chapter.paragraphs),
                notes: Vec::new(),
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
        chapter_images: Vec::new(),
        chapter_background_image: None,
        chapter_number_background_image: None,
        chapter_name_background_image: None,
        note_marker_image: None,
        note_detail_image: None,
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
    let mut book: Project =
        serde_json::from_slice(&data).map_err(|e| format!("项目文件格式错误：{e}"))?;
    book.migrate_chapter_images();
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
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("下载图片失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("下载图片失败：{e}"))?;
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取图片失败：{e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("图片超过 8 MB".into());
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return Err("链接返回的内容不是受支持的图片".into());
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
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

#[cfg(test)]
mod image_tests {
    use super::read_image;
    use std::fs;

    #[test]
    fn reads_webp_as_cover_data_uri() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.webp");
        fs::write(&path, b"RIFF\x04\0\0\0WEBP").unwrap();
        assert_eq!(
            read_image(&path).unwrap(),
            "data:image/webp;base64,UklGRgQAAABXRUJQ"
        );
    }
}
