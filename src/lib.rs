use std::io::{Cursor, Write};
use time::{OffsetDateTime, macros::format_description};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChapterKind {
    /// 卷/部/篇: a grouping heading that contains chapters.
    Volume,
    /// 章/节/回: a normal chapter.
    Chapter,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Chapter {
    pub title: String,
    pub paragraphs: Vec<String>,
    pub kind: ChapterKind,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Book {
    pub title: String,
    pub chapters: Vec<Chapter>,
}

pub fn parse_book(text: &str, title: &str) -> Book {
    let mut chapters = Vec::new();
    let mut current = Chapter {
        title: "前言".into(),
        paragraphs: Vec::new(),
        kind: ChapterKind::Chapter,
    };
    let mut paragraph = String::new();
    let normalized = text
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    for raw in normalized.lines() {
        let line = raw.trim();
        if line.is_empty() {
            flush_paragraph(&mut current, &mut paragraph);
            continue;
        }
        // A heading only starts at a paragraph boundary. Otherwise the line is a
        // hard-wrapped continuation that merely happens to begin with 第…
        let boundary = paragraph.is_empty() || ends_paragraph(&paragraph);
        let kind = if !boundary {
            None
        } else if is_volume_heading(line) {
            Some(ChapterKind::Volume)
        } else if is_chapter_heading(line) {
            Some(ChapterKind::Chapter)
        } else {
            None
        };
        if let Some(kind) = kind {
            flush_paragraph(&mut current, &mut paragraph);
            // Keep an empty volume heading: it groups the chapters that follow.
            if !current.paragraphs.is_empty() || current.kind == ChapterKind::Volume {
                chapters.push(current);
            }
            current = Chapter {
                title: line.to_string(),
                paragraphs: Vec::new(),
                kind,
            };
            continue;
        }
        if paragraph.is_empty() {
            paragraph.push_str(line);
            continue;
        }
        if ends_paragraph(&paragraph) {
            flush_paragraph(&mut current, &mut paragraph);
            paragraph.push_str(line);
            continue;
        }
        if paragraph
            .chars()
            .last()
            .is_some_and(|c| c.is_ascii_alphanumeric())
            && line
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            paragraph.push(' ');
        }
        paragraph.push_str(line);
    }
    flush_paragraph(&mut current, &mut paragraph);
    if !current.paragraphs.is_empty() || chapters.is_empty() {
        if current.title == "前言" && chapters.is_empty() {
            current.title = title.to_string();
        }
        chapters.push(current);
    }
    Book {
        title: title.to_string(),
        chapters,
    }
}

/// Characters that finish a paragraph. A line ending with one of these starts a
/// new paragraph on the next line; any other ending means the line was wrapped
/// at a fixed width and the next line continues it.
const PARAGRAPH_END: &str =
    "。！？!?…～：:“”‘’\"'「」『』（）()【】《》〈〉";
const CHINESE_NUMERALS: &str = "零〇一二三四五六七八九十百千万两";
const VOLUME_UNITS: &str = "卷部篇";
const CHAPTER_UNITS: &str = "章节回集";

fn ends_paragraph(text: &str) -> bool {
    text.chars()
        .last()
        .is_some_and(|c| PARAGRAPH_END.contains(c))
}

fn flush_paragraph(chapter: &mut Chapter, paragraph: &mut String) {
    if !paragraph.is_empty() {
        chapter.paragraphs.push(std::mem::take(paragraph));
    }
}

fn is_chapter_heading(line: &str) -> bool {
    if let Some(unit) = heading_unit(line) {
        return CHAPTER_UNITS.contains(unit);
    }
    let line = line.trim();
    let lower = line.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("chapter ") {
        let number = rest
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches([':', '.']);
        return !number.is_empty()
            && number
                .chars()
                .all(|c| c.is_ascii_digit() || "ivxlcdm".contains(c));
    }
    matches!(
        line,
        "序章" | "楔子" | "引子" | "尾声" | "后记" | "番外" | "终章"
    )
}

fn is_volume_heading(line: &str) -> bool {
    heading_unit(line).is_some_and(|unit| VOLUME_UNITS.contains(unit))
}

/// Parses `第<number><unit>…` headings and returns the unit character.
/// Rejects body sentences that merely begin like a heading.
fn heading_unit(line: &str) -> Option<char> {
    let line = line.trim();
    let length = line.chars().count();
    if line.is_empty() || length > 40 {
        return None;
    }
    // Body sentences end with punctuation; headings do not.
    if line.ends_with(['。', '；', ';', '，', ',', '、']) {
        return None;
    }
    let rest = line.strip_prefix('第')?;
    let number: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || CHINESE_NUMERALS.contains(*c))
        .collect();
    if number.is_empty() {
        return None;
    }
    let after = &rest[number.len()..];
    let unit = after.chars().next()?;
    if !CHAPTER_UNITS.contains(unit) && !VOLUME_UNITS.contains(unit) {
        return None;
    }
    let tail = &after[unit.len_utf8()..];
    if tail.trim_start().starts_with(['“', '「', '『', '"']) {
        // Narrated or quoted chapter numbers ("第1章 “便是…") are body text.
        return None;
    }
    if tail.is_empty() {
        return Some(unit);
    }
    let separated = tail
        .chars()
        .next()
        .is_some_and(|c| c.is_whitespace() || "、，,：:·•.-—–~～「『【(《<".contains(c));
    if separated {
        return Some(unit);
    }
    // "第一章开始" style headings keep the number and a very short tail.
    let tail_length = tail.chars().count();
    if tail_length <= 12 && !tail.chars().any(|c| "，。！？；：、,.!?;:".contains(c)) {
        return Some(unit);
    }
    None
}

pub fn build_epub(book: &Book, author: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    if book.chapters.iter().all(|c| c.paragraphs.is_empty()) {
        return Err("TXT 文件没有可转换的正文".into());
    }
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let compressed = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("mimetype", stored)?;
    zip.write_all(b"application/epub+zip")?;
    zip.start_file("META-INF/container.xml", compressed)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#)?;

    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>",
    );
    let mut spine = String::new();
    let mut links = String::new();
    for (index, chapter) in book.chapters.iter().enumerate() {
        let number = index + 1;
        let filename = format!("text/chapter-{number}.xhtml");
        let id = format!("chapter-{number}");
        manifest.push_str(&format!(
            "<item id=\"{id}\" href=\"{filename}\" media-type=\"application/xhtml+xml\"/>"
        ));
        spine.push_str(&format!("<itemref idref=\"{id}\"/>"));
        links.push_str(&format!(
            "<li><a href=\"{filename}\">{}</a></li>",
            xml_escape(&chapter.title)
        ));
        let paragraphs: String = chapter
            .paragraphs
            .iter()
            .map(|p| format!("<p>{}</p>", xml_escape(p)))
            .collect();
        let body = format!("<h1>{}</h1>{paragraphs}", xml_escape(&chapter.title));
        zip.start_file(format!("OEBPS/{filename}"), compressed)?;
        zip.write_all(xhtml(&chapter.title, &body).as_bytes())?;
    }
    let nav = format!("<nav epub:type=\"toc\" id=\"toc\"><h1>目录</h1><ol>{links}</ol></nav>");
    zip.start_file("OEBPS/nav.xhtml", compressed)?;
    zip.write_all(xhtml("目录", &nav).as_bytes())?;

    let title = xml_escape(&book.title);
    let author = xml_escape(author);
    let modified = OffsetDateTime::now_utc().format(format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second]Z"
    ))?;
    let opf = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">urn:txt2epub:{}</dc:identifier><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>zh-CN</dc:language><meta property=\"dcterms:modified\">{modified}</meta></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>",
        stable_id(book, author.as_str())
    );
    zip.start_file("OEBPS/content.opf", compressed)?;
    zip.write_all(opf.as_bytes())?;
    Ok(zip.finish()?.into_inner())
}

fn stable_id(book: &Book, author: &str) -> String {
    // FNV-1a keeps the identifier stable across repeated conversions.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in book.title.bytes().chain(author.bytes()).chain(
        book.chapters
            .iter()
            .flat_map(|c| c.paragraphs.iter().flat_map(|p| p.bytes())),
    ) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn xhtml(title: &str, body: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>{}</title><meta charset=\"UTF-8\"/></head><body>{body}</body></html>",
        xml_escape(title)
    )
}

fn xml_escape(text: &str) -> String {
    let mut escaped = String::new();
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            '\u{9}'
            | '\u{a}'
            | '\u{d}'
            | '\u{20}'..='\u{d7ff}'
            | '\u{e000}'..='\u{fffd}'
            | '\u{10000}'..='\u{10ffff}' => escaped.push(c),
            _ => {}
        }
    }
    escaped
}
