//! Lists the fonts and images a saved project already carries, so the shared
//! libraries can present them grouped by project and copy a chosen entry into
//! the cross-project library. Extraction copies bytes; the project keeps its
//! own embedded data and stays untouched.

use crate::{assets::AssetStore, cache::CacheStore, project::Project, workspace::WorkspaceStore};
use base64::{Engine, engine::general_purpose::STANDARD};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::OnceLock};

const FONT_MIME: [&str; 4] = ["font/ttf", "font/otf", "font/woff", "font/woff2"];
const IMAGE_MIME: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetRef {
    /// Content fingerprint; stable while the bytes stay the same.
    pub key: String,
    /// Human label such as `封面.png`, unique enough inside one project.
    pub name: String,
    pub mime: String,
    pub size: i64,
    /// True once identical bytes already sit in the shared library.
    pub in_library: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetGroup {
    pub project_id: i64,
    pub project_title: String,
    pub fonts: Vec<ProjectAssetRef>,
    pub images: Vec<ProjectAssetRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetData {
    pub key: String,
    pub name: String,
    pub mime: String,
    pub data_uri: String,
}

struct Entry {
    key: String,
    name: String,
    mime: String,
    bytes: Vec<u8>,
}

impl Entry {
    fn from_uri(uri: &str, name: String) -> Option<Self> {
        let (mime, bytes) = decode_data_uri(uri)?;
        let name = format!("{}.{}", name, extension(&mime));
        Some(Self {
            key: fingerprint(&bytes),
            name,
            mime,
            bytes,
        })
    }
}

/// Build only lightweight references. Each decoded image is dropped before
/// moving to the next one, avoiding a second full copy of a large book.
fn collect_refs(book: &Project, assets: &AssetStore) -> Result<(Vec<ProjectAssetRef>, Vec<ProjectAssetRef>), String> {
    let mut font_keys = HashSet::new();
    let mut fonts = Vec::new();
    for font in &book.font_assets {
        if FONT_MIME.contains(&font.mime.as_str()) {
            let name = if font.name.trim().is_empty() { &font.family } else { &font.name };
            append_ref(assets, "font", &font.data_uri, strip_extension(name), &mut font_keys, &mut fonts)?;
        }
    }

    let mut image_keys = HashSet::new();
    let mut images = Vec::new();

    if let Some(cover) = book.cover_image.as_deref() {
        append_ref(assets, "image", cover, "封面".into(), &mut image_keys, &mut images)?;
    }
    for (index, chapter_image) in book.chapter_images.iter().enumerate() {
        append_ref(assets, "image", &chapter_image.image, format!("章节图 {}", index + 1), &mut image_keys, &mut images)?;
    }
    for volume in &book.volumes {
        if let Some(opening) = volume.opening_image.as_deref() {
            append_ref(assets, "image", opening, format!("卷首图 · {}", volume.title), &mut image_keys, &mut images)?;
        }
        if let Some(closing) = volume.closing_image.as_deref() {
            append_ref(assets, "image", closing, format!("卷尾图 · {}", volume.title), &mut image_keys, &mut images)?;
        }
    }
    let inline = inline_image();
    for chapter in &book.chapters {
        for captures in inline.captures_iter(&chapter.html) {
            if let Some(uri) = captures.get(1) {
                append_ref(assets, "image", uri.as_str(), format!("正文插图 · {}", chapter.title), &mut image_keys, &mut images)?;
            }
        }
    }

    Ok((fonts, images))
}

fn append_ref(
    assets: &AssetStore, kind: &str, uri: &str, name: String,
    seen: &mut HashSet<String>, target: &mut Vec<ProjectAssetRef>,
) -> Result<(), String> {
    let Some(entry) = Entry::from_uri(uri, name) else { return Ok(()) };
    if !seen.insert(entry.key.clone()) { return Ok(()) }
    target.push(ProjectAssetRef {
        in_library: assets.contains_content(kind, &entry.bytes)?,
        key: entry.key,
        name: entry.name,
        size: entry.bytes.len() as i64,
        mime: entry.mime,
    });
    Ok(())
}

/// Locate one resource without decoding every picture in the book again.
fn find_entry(book: &Project, key: &str) -> Option<Entry> {
    let matches = |uri: &str, name: String| {
        Entry::from_uri(uri, name).filter(|entry| entry.key == key)
    };
    for font in &book.font_assets {
        if FONT_MIME.contains(&font.mime.as_str()) {
            let name = if font.name.trim().is_empty() { &font.family } else { &font.name };
            if let Some(entry) = matches(&font.data_uri, strip_extension(name)) { return Some(entry); }
        }
    }
    if let Some(cover) = book.cover_image.as_deref() {
        if let Some(entry) = matches(cover, "封面".into()) { return Some(entry); }
    }
    for (index, image) in book.chapter_images.iter().enumerate() {
        if let Some(entry) = matches(&image.image, format!("章节图 {}", index + 1)) { return Some(entry); }
    }
    for volume in &book.volumes {
        if let Some(opening) = volume.opening_image.as_deref() {
            if let Some(entry) = matches(opening, format!("卷首图 · {}", volume.title)) { return Some(entry); }
        }
        if let Some(closing) = volume.closing_image.as_deref() {
            if let Some(entry) = matches(closing, format!("卷尾图 · {}", volume.title)) { return Some(entry); }
        }
    }
    for chapter in &book.chapters {
        for captures in inline_image().captures_iter(&chapter.html) {
            if let Some(uri) = captures.get(1) {
                if let Some(entry) = matches(uri.as_str(), format!("正文插图 · {}", chapter.title)) { return Some(entry); }
            }
        }
    }
    None
}

fn inline_image() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"<img\b[^>]*\bsrc=["'](data:[^"']+)["']"#).expect("valid image pattern")
    })
}

fn decode_data_uri(uri: &str) -> Option<(String, Vec<u8>)> {
    let payload = uri.strip_prefix("data:")?;
    let (meta, encoded) = payload.split_once(',')?;
    let mime = meta.split(';').next()?.to_ascii_lowercase();
    if !meta.split(';').any(|part| part == "base64") {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.is_empty()
        || (!FONT_MIME.contains(&mime.as_str()) && !IMAGE_MIME.contains(&mime.as_str()))
    {
        return None;
    }
    Some((mime, bytes))
}

fn strip_extension(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, extension))
            if matches!(
                extension.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "woff" | "woff2" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
            ) =>
        {
            stem.to_string()
        }
        _ => name.to_string(),
    }
}

fn kind_of(mime: &str) -> &'static str {
    if mime.starts_with("font/") { "font" } else { "image" }
}

fn extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "font/ttf" => "ttf",
        "font/otf" => "otf",
        "font/woff" => "woff",
        "font/woff2" => "woff2",
        _ => "bin",
    }
}

/// FNV-1a over the bytes; only needs to distinguish entries inside one project.
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The fonts and images embedded in one project, marked with whether the
/// shared library already holds an identical copy.
pub fn list(
    store: &WorkspaceStore,
    assets: &AssetStore,
    project_id: i64,
) -> Result<ProjectAssetGroup, String> {
    let version = store.project_version(project_id)?;
    let revision = assets.revision()?;
    if let Some(json) = store.cached_asset_group(project_id, &version, revision)? {
        if let Ok(group) = serde_json::from_str(&json) { return Ok(group); }
    }
    let book = store.load(project_id)?;
    let (fonts, images) = collect_refs(&book, assets)?;
    let group = ProjectAssetGroup {
        project_id,
        project_title: book.title.clone(),
        fonts,
        images,
    };
    if assets.revision()? == revision {
        let json = serde_json::to_string(&group).map_err(|e| e.to_string())?;
        let _ = store.save_asset_group(project_id, &version, revision, &json);
    }
    Ok(group)
}

/// One project asset as a data URI, for the preview pane. When a cache is
/// given the bytes are kept there, so browsing stays cheap next time.
pub fn read(
    store: &WorkspaceStore,
    project_id: i64,
    key: &str,
    cache: Option<&CacheStore>,
) -> Result<ProjectAssetData, String> {
    let book = store.load(project_id)?;
    let entry = find_entry(&book, key)
        .ok_or_else(|| "工程资源不存在".to_string())?;
    if let Some(cache) = cache {
        let _ = cache.put(kind_of(&entry.mime), &entry.key, &entry.bytes);
    }
    Ok(ProjectAssetData {
        key: entry.key,
        name: entry.name,
        mime: entry.mime.clone(),
        data_uri: format!("data:{};base64,{}", entry.mime, STANDARD.encode(&entry.bytes)),
    })
}

/// Copies one project asset into the shared library. Repeating the call reuses
/// the existing entry, because identical bytes are deduplicated there.
pub fn extract(
    store: &WorkspaceStore,
    assets: &AssetStore,
    project_id: i64,
    key: &str,
    cache: Option<&CacheStore>,
) -> Result<crate::assets::AssetSummary, String> {
    let book = store.load(project_id)?;
    let entry = find_entry(&book, key).ok_or_else(|| "工程资源不存在".to_string())?;
    let kind = kind_of(&entry.mime);
    if let Some(cache) = cache {
        let _ = cache.put(kind, &entry.key, &entry.bytes);
    }
    let name = format!("{} · {}", book.title, entry.name);
    let (summary, _) = assets.import_data(kind, &name, &entry.mime, &entry.bytes)?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{
        BookStyle, ChapterImage, ChapterImagePlacement, ChapterImageScope, EditableChapter,
        EmbeddedFont, TitleLayout,
    };

    fn uri(mime: &str, bytes: &[u8]) -> String {
        format!("data:{mime};base64,{}", STANDARD.encode(bytes))
    }

    fn book() -> Project {
        Project {
            version: 1,
            title: "测试书".into(),
            author: "作者".into(),
            language: "zh-CN".into(),
            style: BookStyle::default(),
            cover_image: Some(uri("image/png", b"cover")),
            chapter_images: vec![ChapterImage {
                id: "i1".into(),
                image: uri("image/png", b"chapter"),
                placement: ChapterImagePlacement::Below,
                scope: ChapterImageScope::All,
            }],
            opening_image: None,
            closing_image: None,
            font_assets: vec![EmbeddedFont {
                family: "EPUBStudioFont7".into(),
                name: "宋体.ttf".into(),
                mime: "font/ttf".into(),
                data_uri: uri("font/ttf", b"font-data"),
            }],
            volumes: vec![],
            chapters: vec![
                EditableChapter {
                    id: "c1".into(),
                    title: "第一章".into(),
                    title_layout: TitleLayout::Stacked,
                    title_id: None,
                    volume_id: None,
                    html: format!("<p>x</p><img src=\"{}\">", uri("image/png", b"inline")),
                    notes: vec![],
                },
                // Same inline picture again: the list keeps one entry.
                EditableChapter {
                    id: "c2".into(),
                    title: "第二章".into(),
                    title_layout: TitleLayout::Stacked,
                    title_id: None,
                    volume_id: None,
                    html: format!("<p>y</p><img src=\"{}\">", uri("image/png", b"inline")),
                    notes: vec![],
                },
            ],
        }
    }

    fn stores(dir: &std::path::Path) -> (WorkspaceStore, AssetStore) {
        let path = dir.join("assets.sqlite3");
        (WorkspaceStore::open(&path).unwrap(), AssetStore::open(&path).unwrap())
    }

    #[test]
    fn groups_project_fonts_and_images_without_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, assets) = stores(dir.path());
        let created = workspace.create(&book()).unwrap();
        let group = list(&workspace, &assets, created.id).unwrap();
        assert_eq!(group.project_title, "测试书");
        assert_eq!(group.fonts.len(), 1);
        assert_eq!(group.fonts[0].name, "宋体.ttf");
        assert_eq!(group.fonts[0].mime, "font/ttf");
        assert!(!group.fonts[0].in_library);
        // 封面 / 章节图 1 / 正文插图（两章同图只算一次）
        assert_eq!(group.images.len(), 3);
        assert_eq!(group.images[0].name, "封面.png");
        assert_eq!(group.images[1].name, "章节图 1.png");
        assert!(group.images[2].name.starts_with("正文插图"));
        assert!(group.images.iter().all(|image| !image.in_library));
    }

    #[test]
    fn extracting_copies_into_library_and_marks_it_shared() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, assets) = stores(dir.path());
        let created = workspace.create(&book()).unwrap();
        let group = list(&workspace, &assets, created.id).unwrap();
        let image = group.images[0].clone();

        let first = extract(&workspace, &assets, created.id, &image.key, None).unwrap();
        let second = extract(&workspace, &assets, created.id, &image.key, None).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.name, "测试书 · 封面.png");
        assert_eq!(assets.list("image").unwrap().len(), 1);

        let refreshed = list(&workspace, &assets, created.id).unwrap();
        assert!(refreshed.images[0].in_library);
        assert!(!refreshed.images[1].in_library);

        let font = refreshed.fonts[0].clone();
        let stored = extract(&workspace, &assets, created.id, &font.key, None).unwrap();
        assert_eq!(stored.kind, "font");
        assert_eq!(assets.list("font").unwrap().len(), 1);
        // The book itself keeps its own embedded copy.
        assert_eq!(workspace.load(created.id).unwrap().cover_image, book().cover_image);
    }

    #[test]
    fn cached_group_is_rebuilt_after_project_save() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, assets) = stores(dir.path());
        let created = workspace.create(&book()).unwrap();
        let first = list(&workspace, &assets, created.id).unwrap();
        let version = workspace.project_version(created.id).unwrap();
        assert!(workspace.cached_asset_group(created.id, &version, assets.revision().unwrap()).unwrap().is_some());
        // A second listing uses the metadata index without parsing book_json.
        rusqlite::Connection::open(dir.path().join("assets.sqlite3")).unwrap()
            .execute("UPDATE projects SET book_json='invalid' WHERE id=?1", [created.id]).unwrap();
        assert_eq!(list(&workspace, &assets, created.id).unwrap().images.len(), first.images.len());

        let mut changed = book();
        changed.cover_image = Some(uri("image/png", b"different-cover"));
        workspace.save(created.id, &changed).unwrap();
        let second = list(&workspace, &assets, created.id).unwrap();
        assert_ne!(first.images[0].key, second.images[0].key);
        assert_eq!(second.images[0].size, b"different-cover".len() as i64);
    }

    #[test]
    fn unknown_keys_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, assets) = stores(dir.path());
        let created = workspace.create(&book()).unwrap();
        assert!(read(&workspace, created.id, "nope", None).is_err());
        assert!(extract(&workspace, &assets, created.id, "nope", None).is_err());
    }
}
