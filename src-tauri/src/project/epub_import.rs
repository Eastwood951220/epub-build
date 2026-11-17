use base64::{Engine, engine::general_purpose::STANDARD};
use percent_encoding::percent_decode_str;
use regex::Regex;
use roxmltree::{Document, Node};
use std::{collections::HashMap, fs, io::Read, path::Path};
use zip::ZipArchive;

use super::{BookStyle, ChapterNote, EditableChapter, Project, TitleLayout, escape_xml};

pub(super) fn import_epub(path: &Path) -> Result<Project, String> {
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
        let mut title = format!("章节 {}", drafts.len() + 1);
        let mut title_layout = TitleLayout::Stacked;
        let mut title_id = None;
        let mut html = String::new();
        let mut anchors = Vec::new();
        let mut started = false;
        for block in blocks {
            if block.has_tag_name(split_tag) {
                if started {
                    drafts.push(ImportedChapter {
                        title: std::mem::take(&mut title),
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
                title_layout: draft.title_layout,
                title_id: draft.title_id,
                volume_id: None,
                html: draft.html,
                notes: draft.notes,
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
        chapter_images: Vec::new(),
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
    title_layout: TitleLayout,
    title_id: Option<String>,
    html: String,
    notes: Vec<ChapterNote>,
    anchors: Vec<String>,
    source_path: String,
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
