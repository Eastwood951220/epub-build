use base64::{Engine, engine::general_purpose::STANDARD};
use percent_encoding::percent_decode_str;
use regex::Regex;
use roxmltree::{Document, Node, ParsingOptions};
use std::{collections::HashMap, fs, io::Read, path::Path};
use zip::ZipArchive;

use super::{
    BookStyle, ChapterImage, ChapterImagePlacement, ChapterImageScope, ChapterNote,
    EditableChapter, Project, TitleLayout, Volume, VolumeStyle, escape_xml,
};

/// Reads a shared chapter-page background from an EPUB stylesheet. Only body
/// rules are considered; decorative images inside notes and headings remain
/// ordinary content assets.
fn read_chapter_background(
    archive: &mut ZipArchive<fs::File>,
    opf_path: &str,
    manifest: &HashMap<String, (String, String)>,
) -> (Option<String>, String) {
    let comments = Regex::new(r"(?s)/\*.*?\*/").unwrap();
    let body_rule = Regex::new(r"(?is)\bbody(?:\.chapter-page)?\s*\{([^}]*)\}").unwrap();
    let image_url = Regex::new(r#"(?i)\bbackground(?:-image)?\s*:[^;]*?url\(\s*['"]?([^)'"\s]+)"#).unwrap();
    let background_size = Regex::new(r"(?i)\bbackground-size\s*:\s*([^;}]*)").unwrap();
    for (href, _) in manifest.values().filter(|(href, _)| href.to_ascii_lowercase().ends_with(".css")) {
        let Ok(css_path) = resolve_zip_path(opf_path, href) else { continue };
        let Ok(css) = zip_text(archive, &css_path) else { continue };
        let css = comments.replace_all(&css, "");
        for rule in body_rule.captures_iter(&css) {
            let declaration = &rule[1];
            let Some(url) = image_url.captures(declaration).map(|capture| capture[1].to_string()) else { continue };
            let Ok(image_path) = resolve_zip_path(&css_path, &url) else { continue };
            let Some(mime) = image_mime(&image_path) else { continue };
            let Ok(mut image) = archive.by_name(&image_path) else { continue };
            let mut bytes = Vec::new();
            if image.read_to_end(&mut bytes).is_err() { continue }
            let size = background_size.captures(declaration).map(|capture| capture[1].trim().to_ascii_lowercase()).unwrap_or_default();
            let size = match size.as_str() { "contain" | "100% 100%" | "100% auto" => size, _ => "cover".into() };
            return (Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))), size);
        }
    }
    (None, "cover".into())
}

/// 解析 EPUB 内的 XML。出版物常用 `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN">`
/// 声明外部 DTD，roxmltree 默认拒绝这类文档，因此显式允许 DTD。
fn parse_xml(text: &str) -> Result<Document<'_>, roxmltree::Error> {
    let options = ParsingOptions {
        allow_dtd: true,
        ..ParsingOptions::default()
    };
    Document::parse_with_options(text, options)
}

pub(super) fn import_epub(path: &Path) -> Result<Project, String> {
    let file = fs::File::open(path).map_err(|e| format!("打开 EPUB 失败：{e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("EPUB 文件无效：{e}"))?;
    let container = zip_text(&mut archive, "META-INF/container.xml")?;
    let container_doc = parse_xml(&container).map_err(|e| format!("container.xml 无效：{e}"))?;
    let opf_path = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("EPUB 未指定内容文件")?
        .to_string();
    let opf = zip_text(&mut archive, &opf_path)?;
    let opf_doc = parse_xml(&opf).map_err(|e| format!("EPUB 内容文件无效：{e}"))?;
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
    let (chapter_background_image, chapter_background_size) =
        read_chapter_background(&mut archive, &opf_path, &manifest);
    let spine = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("spine"))
        .ok_or("EPUB 缺少阅读顺序")?;
    let mut drafts: Vec<ImportedChapter> = Vec::new();
    let mut volumes: Vec<Volume> = Vec::new();
    // 当前所在的卷：卷标题之后的章节都归属到它。
    let mut current_volume: Option<String> = None;
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
        let doc = parse_xml(&source).map_err(|e| format!("章节 {} 无效：{e}", chapter_path))?;
        let body = doc
            .descendants()
            .find(|n| n.has_tag_name("body"))
            .ok_or("章节缺少正文")?;
        let mut chapter_notes: Vec<ChapterNote> = body
            .descendants()
            .filter(|node| {
                node.has_tag_name("section")
                    && node.attribute("class").is_some_and(|classes| {
                        classes
                            .split_whitespace()
                            .any(|class| class == "chapter-notes")
                    })
            })
            .flat_map(|section| section.children().filter(|node| node.has_tag_name("p")))
            .filter_map(|paragraph| {
                let id = paragraph
                    .attribute("id")?
                    .strip_prefix("note-")?
                    .to_string();
                let text = paragraph
                    .children()
                    .filter(|child| !child.has_tag_name("a"))
                    .map(node_text)
                    .collect::<String>()
                    .trim()
                    .to_string();
                Some(ChapterNote { id, text })
            })
            .collect();
        let mut blocks = Vec::new();
        for child in body.children() {
            flatten_blocks(child, &mut blocks);
        }
        let split_tag = if blocks.iter().any(|n| n.has_tag_name("h1")) {
            "h1"
        } else {
            "h2"
        };
        // 卷页：整份文件只有一个标题，且标题写作「第X卷」或「卷丨壹丨」这类卷标题。
        // 这种文件不该变成章节，而是生成一个卷，后续章节归属到它。
        let headings: Vec<Node<'_, '_>> = blocks
            .iter()
            .copied()
            .filter(|block| block.has_tag_name(split_tag))
            .collect();
        if headings.len() == 1 && is_volume_heading(&imported_heading_text(headings[0])) {
            let heading = headings[0];
            let mut title = imported_heading_text(heading);
            let mut subtitle = String::new();
            let mut opening_image = None;
            for block in blocks.iter().copied().skip_while(|block| *block != heading) {
                if block == heading {
                    continue;
                }
                let content = import_node(block, &chapter_path, &mut archive);
                if opening_image.is_none() && content.contains("<img") {
                    opening_image = data_uri_in(&content, 0..content.len());
                }
                if subtitle.is_empty() {
                    let text = node_text(block).trim().to_string();
                    if !text.is_empty() && text.chars().count() <= 40 {
                        subtitle = text;
                    }
                }
            }
            if !subtitle.is_empty() && !title.contains(&subtitle) {
                title = format!("{title} {subtitle}");
            }
            let volume_id = format!("volume-{}", volumes.len() + 1);
            volumes.push(Volume {
                id: volume_id.clone(),
                title,
                title_layout: TitleLayout::Stacked,
                style: VolumeStyle::default(),
                opening_image,
                closing_image: None,
            });
            current_volume = Some(volume_id);
            continue;
        }
        let mut title = format!("章节 {}", drafts.len() + 1);
        let mut title_layout = TitleLayout::Stacked;
        let mut title_id = None;
        let mut html = String::new();
        let mut anchors = Vec::new();
        let mut started = false;
        // 记下当前这一段是否已有文字。只有插图（没有文字）的开头内容，
        // 例如标题上方的整页插图，不该单独成为一章，而是并进它后面的章节。
        let mut has_text = false;
        // 章节开头的插图（标题之前或紧随标题之后、正文之前）记为边界插图，
        // 同一张图被多章重复引用时改存为章节插图。
        let mut before_title = true;
        let mut boundary_image: Option<(String, std::ops::Range<usize>, bool)> = None;
        for block in blocks {
            if block.has_tag_name(split_tag) {
                if started && has_text {
                    drafts.push(ImportedChapter {
                        title: std::mem::take(&mut title),
                        volume_id: current_volume.clone(),
                        boundary_image: boundary_image.take(),
                        title_layout,
                        title_id: title_id.take(),
                        html: std::mem::take(&mut html),
                        notes: Vec::new(),
                        anchors: std::mem::take(&mut anchors),
                        source_path: chapter_path.clone(),
                    });
                }
                title = imported_heading_text(block);
                title_layout = if block.attribute("class").is_some_and(|classes| {
                    classes
                        .split_whitespace()
                        .any(|class| class == "title-inline")
                }) {
                    TitleLayout::Inline
                } else {
                    TitleLayout::Stacked
                };
                if title.is_empty() {
                    title = format!("章节 {}", drafts.len() + 1);
                }
                title_id = block.attribute("id").map(str::to_string);
                if let Some(id) = &title_id {
                    anchors.push(id.clone());
                }
                started = true;
                has_text = false;
                before_title = false;
            } else {
                for node in block.descendants() {
                    if node.is_element()
                        && supports_id(node.tag_name().name())
                        && let Some(id) = node.attribute("id")
                    {
                        anchors.push(id.to_string());
                    }
                }
                if block_has_text(block) {
                    has_text = true;
                }
                let content = import_node(block, &chapter_path, &mut archive);
                if !content.trim().is_empty() {
                    started = true;
                }
                if boundary_image.is_none()
                    && !has_text
                    && html.trim().is_empty()
                    && content.contains("<img")
                {
                    // 以压缩包内的图片路径为准，同一张图被多章引用才算重复。
                    let image_path = block
                        .descendants()
                        .find(|node| node.has_tag_name("img"))
                        .and_then(|node| node.attribute("src"))
                        .and_then(|src| resolve_zip_path(&chapter_path, src).ok());
                    if let Some(path) = image_path {
                        let start = html.len();
                        boundary_image = Some((path, start..start + content.len(), before_title));
                    }
                }
                html.push_str(&content);
            }
        }
        if started {
            drafts.push(ImportedChapter {
                title,
                volume_id: current_volume.clone(),
                boundary_image: boundary_image.take(),
                title_layout,
                title_id,
                html,
                notes: std::mem::take(&mut chapter_notes),
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
    let mut boundary_images: Vec<Option<(String, std::ops::Range<usize>, bool)>> = Vec::new();
    let mut chapters: Vec<EditableChapter> = drafts
        .into_iter()
        .enumerate()
        .map(|(index, mut draft)| {
            boundary_images.push(draft.boundary_image.take());
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
                title_layout: draft.title_layout,
                title_id: draft.title_id,
                volume_id: draft.volume_id,
                html: draft.html,
                notes: draft.notes,
            }
        })
        .collect();
    // 出版物常把同一张整页插图重复放在很多章的开头。逐章内联会让工程重复保存同一份
    // 图片数据（这本书因此膨胀到 663MB），重复出现的章首图改成章节插图，只存一份。
    let chapter_images = hoist_repeated_images(&mut chapters, &boundary_images);
    Ok(Project {
        version: 1,
        title,
        author,
        language,
        style: BookStyle { chapter_background_size, ..BookStyle::default() },
        cover_image,
        chapter_images,
        chapter_background_image,
        note_marker_image: None,
        note_detail_image: None,
        opening_image: None,
        closing_image: None,
        font_assets: Vec::new(),
        volumes,
        chapters,
    })
}

/// 把「在多章开头重复出现的同一张图」从正文里提出来，改存为章节插图，
/// 让工程只保留一份图片数据。识别以压缩包内的图片路径为准，不必再比对 base64。
/// 位置保持原样：标题之前的图记作上方图，标题之后的图记作下方图。
fn hoist_repeated_images(
    chapters: &mut [EditableChapter],
    boundary_images: &[Option<(String, std::ops::Range<usize>, bool)>],
) -> Vec<ChapterImage> {
    let mut chapters_by_image: HashMap<(&str, bool), Vec<usize>> = HashMap::new();
    for (index, boundary) in boundary_images.iter().enumerate() {
        if let Some((path, _, above)) = boundary {
            chapters_by_image
                .entry((path.as_str(), *above))
                .or_default()
                .push(index);
        }
    }
    let mut repeated: Vec<((&str, bool), Vec<usize>)> = chapters_by_image
        .into_iter()
        .filter(|(_, indexes)| indexes.len() > 1)
        .collect();
    repeated.sort_by_key(|(_, indexes)| indexes[0]);
    let mut entries = Vec::new();
    let mut created: Vec<(&str, bool)> = Vec::new();
    for (number, ((path, above), indexes)) in repeated.iter().enumerate() {
        let Some((_, range, _)) = &boundary_images[indexes[0]] else {
            continue;
        };
        let Some(image) = data_uri_in(&chapters[indexes[0]].html, range.clone()) else {
            continue;
        };
        created.push((path, *above));
        entries.push(ChapterImage {
            id: format!("import-image-{}", number + 1),
            image,
            placement: if *above {
                ChapterImagePlacement::Above
            } else {
                ChapterImagePlacement::Below
            },
            scope: ChapterImageScope::Chapters {
                ids: indexes
                    .iter()
                    .map(|index| chapters[*index].id.clone())
                    .collect(),
            },
        });
    }
    let hoisted: std::collections::HashSet<(&str, bool)> = created.into_iter().collect();
    for (index, boundary) in boundary_images.iter().enumerate() {
        let Some((path, range, above)) = boundary else {
            continue;
        };
        if !hoisted.contains(&(path.as_str(), *above)) || range.end > chapters[index].html.len() {
            continue;
        }
        let chapter = &mut chapters[index];
        chapter.html.replace_range(range.clone(), "");
        chapter.html = chapter.html.trim_start().to_string();
    }
    entries
}

/// 从 `src` 属性取出 base64 图片数据，找不到或不是内联图片时返回 `None`。
fn data_uri_in(html: &str, range: std::ops::Range<usize>) -> Option<String> {
    let tag = html.get(range)?;
    let start = tag.find("src=")? + 4;
    let rest = &tag[start..];
    let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let value = &rest[1..];
    let end = value.find(quote)?;
    let uri = &value[..end];
    uri.starts_with("data:image/").then(|| uri.to_string())
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
    /// 这一章所属的卷（导入时按卷标题切分）。
    volume_id: Option<String>,
    /// 章节开头的插图块：压缩包内的图片路径、在正文里的位置、是否位于标题上方。
    boundary_image: Option<(String, std::ops::Range<usize>, bool)>,
    title_layout: TitleLayout,
    title_id: Option<String>,
    html: String,
    notes: Vec<ChapterNote>,
    anchors: Vec<String>,
    source_path: String,
}

fn block_has_text(block: Node<'_, '_>) -> bool {
    block
        .descendants()
        .filter(|node| node.is_text())
        .any(|node| node.text().is_some_and(|text| !text.trim().is_empty()))
}

fn flatten_blocks<'a, 'input>(node: Node<'a, 'input>, output: &mut Vec<Node<'a, 'input>>) {
    if node.has_tag_name("section")
        && node.attribute("class").is_some_and(|classes| {
            classes
                .split_whitespace()
                .any(|class| class == "chapter-notes")
        })
    {
        return;
    }
    if node.is_element()
        && node.attribute("class").is_some_and(|classes| {
            classes
                .split_whitespace()
                .any(|class| class == "note-box" || class == "case-c")
        })
    {
        output.push(node);
        return;
    }
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

/// 卷标题的判定：`第X卷` / `第X部` / `第X篇`，或 `卷丨壹丨`、`卷壹` 这类以「卷」开头带数字的写法。
fn is_volume_heading(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 40 {
        return false;
    }
    if let Some(unit) = crate::txt::heading_unit(text) {
        return "卷部篇".contains(unit);
    }
    let Some(rest) = text.strip_prefix('卷') else {
        return false;
    };
    let rest =
        rest.trim_start_matches(|c: char| c.is_whitespace() || ":：,，、.．·—-丨|".contains(c));
    let digits: String = rest.chars().take_while(|c| is_numeral_char(*c)).collect();
    !digits.is_empty()
}

fn is_numeral_char(c: char) -> bool {
    c.is_ascii_digit()
        || "０１２３４５６７８９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬"
            .contains(c)
}

fn imported_heading_text(node: Node<'_, '_>) -> String {
    let part = |class: &str| {
        node.children()
            .find(|child| {
                child.has_tag_name("span")
                    && child
                        .attribute("class")
                        .is_some_and(|classes| classes.split_whitespace().any(|item| item == class))
            })
            .map(node_text)
    };
    match (part("heading-number"), part("heading-name")) {
        (Some(number), Some(name)) => format!("{} {}", number.trim(), name.trim()),
        _ => node_text(node).trim().to_string(),
    }
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
    if tag == "div"
        && node
            .attribute("class")
            .is_some_and(|classes| classes.split_whitespace().any(|class| class == "case-c"))
    {
        let title = node
            .children()
            .find(|child| {
                child.has_tag_name("p")
                    && child.attribute("class").is_some_and(|classes| {
                        classes.split_whitespace().any(|class| class == "tj-c")
                    })
            })
            .map(node_text)
            .unwrap_or_else(|| "小贴士".into());
        let content = node
            .children()
            .filter(|child| {
                !child.has_tag_name("p")
                    || !child.attribute("class").is_some_and(|classes| {
                        classes.split_whitespace().any(|class| class == "tj-c")
                    })
            })
            .map(|child| import_node(child, chapter_path, archive))
            .collect::<String>();
        return format!(
            "<aside class=\"note-box\"><p class=\"note-box-title\">{}</p>{content}</aside>",
            escape_xml(title.trim())
        );
    }
    let children: String = node
        .children()
        .map(|child| import_node(child, chapter_path, archive))
        .collect();
    if tag == "p"
        && node.attribute("class").is_some_and(|classes| {
            classes
                .split_whitespace()
                .any(|class| class == "note-box-title")
        })
    {
        return format!("<p class=\"note-box-title\">{children}</p>");
    }
    if tag == "aside"
        && node
            .attribute("class")
            .is_some_and(|classes| classes.split_whitespace().any(|class| class == "note-box"))
    {
        return format!("<aside class=\"note-box\">{children}</aside>");
    }
    let id = if supports_id(tag) {
        node.attribute("id")
            .map(|value| format!(" id=\"{}\"", escape_xml(value)))
            .unwrap_or_default()
    } else {
        String::new()
    };
    if tag == "a" {
        let href = node.attribute("href").unwrap_or("");
        if node.attribute(("http://www.idpf.org/2007/ops", "type")) == Some("noteref")
            && let Some(id) = href.strip_prefix("#note-")
        {
            return format!(
                "<span data-note-id=\"{}\">{children}</span>",
                escape_xml(id)
            );
        }
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
