use std::{borrow::Cow, collections::BTreeSet};

use fontoxide_subset::{Options, Subsetter};
use fontoxide_ttlib::{Flavor, Font, ReadOptions, WriteOptions};
use regex::Regex;
use ttf_parser::{Face, Tag};

use super::Project;

/// Include every visible character, regardless of which style currently uses a font.
/// This conservative union keeps fallback and nested inline styling safe.
pub(super) fn book_characters(book: &Project) -> BTreeSet<char> {
    let mut characters: BTreeSet<char> = "备注目录[0123456789]".chars().collect();
    characters.extend(book.title.chars());
    characters.extend(book.author.chars());
    for volume in &book.volumes {
        characters.extend(volume.title.chars());
    }
    let tags = Regex::new(r"(?s)<[^>]*>").unwrap();
    for chapter in &book.chapters {
        characters.extend(chapter.title.chars());
        let mut end = 0;
        for tag in tags.find_iter(&chapter.html) {
            characters
                .extend(html_escape::decode_html_entities(&chapter.html[end..tag.start()]).chars());
            end = tag.end();
        }
        characters.extend(html_escape::decode_html_entities(&chapter.html[end..]).chars());
        for note in &chapter.notes {
            characters.extend(note.text.chars());
        }
    }
    characters
}

/// Keep the original if this format or font cannot be safely subsetted.
pub(super) fn smaller_font_subset(
    mime: &str,
    original: &[u8],
    characters: &BTreeSet<char>,
) -> Option<Vec<u8>> {
    if !matches!(mime, "font/ttf" | "font/otf" | "font/woff" | "font/woff2") {
        return None;
    }
    let mut font = Font::read(original, ReadOptions::default()).ok()?;
    let expected_flavor = match mime {
        "font/woff" => Some(Flavor::Woff),
        "font/woff2" => Some(Flavor::Woff2),
        _ => None,
    };
    if font.flavor != expected_flavor {
        return None;
    }
    let source_bytes: Cow<'_, [u8]> = if expected_flavor.is_some() {
        let mut decoded = Font::read(original, ReadOptions::default()).ok()?;
        decoded.flavor = None;
        Cow::Owned(decoded.write(&WriteOptions::default()).ok()?)
    } else {
        Cow::Borrowed(original)
    };
    let source = Face::parse(&source_bytes, 0).ok()?;
    if let Some(os2) = source.raw_face().table(Tag::from_bytes(b"OS/2"))
        && os2.len() >= 10
        && u16::from_be_bytes([os2[8], os2[9]]) & 0x0100 != 0
    {
        return None;
    }
    let mut subsetter = Subsetter::new(Options::default());
    let text: String = characters.iter().collect();
    subsetter.populate(&[], &[], &[], &text);
    subsetter.subset(&mut font).ok()?;
    let subset = font.write(&WriteOptions::default()).ok()?;
    if subset.len() >= original.len() {
        return None;
    }
    let result_bytes: Cow<'_, [u8]> = if expected_flavor.is_some() {
        let mut decoded = Font::read(subset.as_slice(), ReadOptions::default()).ok()?;
        decoded.flavor = None;
        Cow::Owned(decoded.write(&WriteOptions::default()).ok()?)
    } else {
        Cow::Borrowed(&subset)
    };
    let result = Face::parse(&result_bytes, 0).ok()?;
    if characters.iter().any(|character| {
        source.glyph_index(*character).is_some() && result.glyph_index(*character).is_none()
    }) {
        return None;
    }
    Some(subset)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use fontoxide_ttlib::{Flavor, Font, ReadOptions, WriteOptions};

    use super::smaller_font_subset;

    #[test]
    fn keeps_fonts_that_forbid_subsetting() {
        let mut font = include_bytes!("../../tests/fixtures/abel/Abel-Regular.ttf").to_vec();
        let tables = u16::from_be_bytes([font[4], font[5]]) as usize;
        let os2 = (0..tables)
            .map(|index| 12 + index * 16)
            .find(|offset| &font[*offset..*offset + 4] == b"OS/2")
            .unwrap();
        let table_start = u32::from_be_bytes(font[os2 + 8..os2 + 12].try_into().unwrap()) as usize;
        font[table_start + 8] |= 0x01;
        let characters: BTreeSet<char> = "Abel".chars().collect();
        assert!(smaller_font_subset("font/ttf", &font, &characters).is_none());
    }

    #[test]
    fn subsets_woff_while_preserving_its_format() {
        let mut font = Font::read(
            include_bytes!("../../tests/fixtures/abel/Abel-Regular.ttf").to_vec(),
            ReadOptions::default(),
        )
        .unwrap();
        font.flavor = Some(Flavor::Woff);
        let original = font.write(&WriteOptions::default()).unwrap();
        let characters: BTreeSet<char> = "Abel".chars().collect();
        let subset = smaller_font_subset("font/woff", &original, &characters).unwrap();
        assert!(subset.starts_with(b"wOFF"));
        assert!(subset.len() < original.len());
    }
}
