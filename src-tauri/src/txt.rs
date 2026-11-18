//! Plain-text book parsing: splits a TXT manuscript into chapters and volumes.

use regex::Regex;

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
    parse_book_inner(text, title, None, None)
}

/// Custom patterns are matched against a trimmed, complete line. When present,
/// they replace the corresponding built-in heading detector.
pub fn parse_book_with_patterns(
    text: &str,
    title: &str,
    chapter_pattern: Option<&str>,
    volume_pattern: Option<&str>,
) -> Result<Book, String> {
    let compile = |pattern: Option<&str>, label: &str| -> Result<Option<Regex>, String> {
        let Some(pattern) = pattern.filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        let regex = Regex::new(pattern).map_err(|error| format!("{label}正则无效：{error}"))?;
        if regex.is_match("") {
            return Err(format!("{label}正则不能匹配空行"));
        }
        Ok(Some(regex))
    };
    let chapter = compile(chapter_pattern, "章节")?;
    let volume = compile(volume_pattern, "卷")?;
    Ok(parse_book_inner(
        text,
        title,
        chapter.as_ref(),
        volume.as_ref(),
    ))
}

fn parse_book_inner(
    text: &str,
    title: &str,
    chapter_pattern: Option<&Regex>,
    volume_pattern: Option<&Regex>,
) -> Book {
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
        } else if volume_pattern
            .map_or_else(|| is_volume_heading(line), |pattern| pattern.is_match(line))
        {
            Some(ChapterKind::Volume)
        } else if chapter_pattern.map_or_else(
            || is_chapter_heading(line),
            |pattern| pattern.is_match(line),
        ) {
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
const PARAGRAPH_END: &str = "。！？!?…～：:“”‘’\"'「」『』（）()【】《》〈〉";
const CHINESE_NUMERALS: &str = "零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬";
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
    if numbered_dun_heading(line) {
        return true;
    }
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

fn numbered_dun_heading(line: &str) -> bool {
    let line = line.trim();
    if line.chars().count() > 80 {
        return false;
    }
    let digits = line.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 || digits > 4 {
        return false;
    }
    let tail = &line[digits..];
    tail.strip_prefix('、').is_some_and(|name| {
        !name.trim().is_empty() && !name.ends_with(['。', '；', ';', '，', ','])
    })
}

fn is_volume_heading(line: &str) -> bool {
    heading_unit(line).is_some_and(|unit| VOLUME_UNITS.contains(unit))
}

/// Parses `第<number><unit>…` headings and returns the unit character.
/// Rejects body sentences that merely begin like a heading.
pub(crate) fn heading_unit(line: &str) -> Option<char> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_upper_case_chinese_headings() {
        assert!(is_chapter_heading("第壹章 开端"));
        assert!(is_chapter_heading("第贰拾叁回 归途"));
        assert_eq!(heading_unit("第壹卷 少年"), Some('卷'));
    }
}
