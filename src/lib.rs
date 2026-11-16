use std::io::{Cursor, Write};
use time::{OffsetDateTime, macros::format_description};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[derive(Debug, PartialEq, Eq)]
pub struct Chapter {
    pub title: String,
    pub paragraphs: Vec<String>,
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
    };
    let mut paragraph = String::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.is_empty() {
            flush_paragraph(&mut current, &mut paragraph);
        } else if is_chapter_heading(line) {
            flush_paragraph(&mut current, &mut paragraph);
            if !current.paragraphs.is_empty() {
                chapters.push(current);
            }
            current = Chapter {
                title: line.to_string(),
                paragraphs: Vec::new(),
            };
        } else {
            if !paragraph.is_empty()
                && paragraph
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

fn flush_paragraph(chapter: &mut Chapter, paragraph: &mut String) {
    if !paragraph.is_empty() {
        chapter.paragraphs.push(std::mem::take(paragraph));
    }
}

fn is_chapter_heading(line: &str) -> bool {
    if line.chars().count() > 80 {
        return false;
    }
    if let Some(rest) = line.strip_prefix('第')
        && let Some(pos) = rest.find(['章', '节', '回'])
    {
        return pos > 0
            && pos <= 20
            && rest[..pos]
                .chars()
                .all(|c| c.is_ascii_digit() || "零〇一二三四五六七八九十百千万两".contains(c));
    }
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
    false
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
