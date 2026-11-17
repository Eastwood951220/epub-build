use epub_studio::txt::{ChapterKind, parse_book, parse_book_with_patterns};

#[test]
fn splits_chapters_and_preserves_intro() {
    let book = parse_book(
        "序言内容\n\n第一章 开始\n第一段。\n\n第二章 继续\n第二段。",
        "测试书",
    );
    assert_eq!(book.chapters.len(), 3);
    assert_eq!(book.chapters[0].title, "前言");
    assert_eq!(book.chapters[1].title, "第一章 开始");
    assert_eq!(book.chapters[2].paragraphs, vec!["第二段。"]);
}

#[test]
fn plain_text_becomes_one_chapter() {
    let book = parse_book("甲 < 乙 & 丙\n\n第二段", "书名");
    assert_eq!(book.chapters.len(), 1);
    assert_eq!(book.chapters[0].paragraphs, vec!["甲 < 乙 & 丙", "第二段"]);
}

#[test]
fn line_breaks_start_new_paragraphs() {
    let book = parse_book("第一章 开始\n第一段。\n第二段。\n第三段。", "书名");
    assert_eq!(book.chapters.len(), 1);
    assert_eq!(
        book.chapters[0].paragraphs,
        vec!["第一段。", "第二段。", "第三段。"]
    );
}

#[test]
fn hard_wrapped_lines_are_rejoined() {
    let book = parse_book(
        "第一章 开始\n这是一个被窄屏\n硬折行拆开的句子。\n\n下一段。",
        "书名",
    );
    assert_eq!(
        book.chapters[0].paragraphs,
        vec!["这是一个被窄屏硬折行拆开的句子。", "下一段。"]
    );
}

#[test]
fn body_lines_mentioning_a_lesson_are_not_chapters() {
    let book = parse_book(
        "第一章 开始\n第一节课上完，休息间隙很长。\n第二节课开始。",
        "书名",
    );
    assert_eq!(book.chapters.len(), 1);
    assert_eq!(
        book.chapters[0].paragraphs,
        vec!["第一节课上完，休息间隙很长。", "第二节课开始。"]
    );
}

#[test]
fn quoted_chapter_numbers_stay_in_the_body() {
    let book = parse_book("第一章 开始\n第1章 “便是改革天皇制度”\n正文继续。", "书名");
    assert_eq!(book.chapters.len(), 1);
    assert_eq!(book.chapters[0].paragraphs.len(), 2);
}

#[test]
fn volume_headings_are_marked_as_volumes() {
    let book = parse_book("前言文字\n\n第一卷 少年\n第一章 开始\n正文。", "书名");
    assert_eq!(book.chapters.len(), 3);
    assert_eq!(book.chapters[0].kind, ChapterKind::Chapter);
    assert_eq!(book.chapters[1].kind, ChapterKind::Volume);
    assert_eq!(book.chapters[1].title, "第一卷 少年");
    assert_eq!(book.chapters[2].kind, ChapterKind::Chapter);
}

#[test]
fn volume_and_punctuated_headings_are_chapters() {
    let book = parse_book(
        "第一卷 少年\n正文。\n第二十一章，债台高筑\n正文。\n尾声\n完。",
        "书名",
    );
    let titles: Vec<&str> = book.chapters.iter().map(|c| c.title.as_str()).collect();
    assert_eq!(titles, vec!["第一卷 少年", "第二十一章，债台高筑", "尾声"]);
}

#[test]
fn numbered_dun_headings_split_within_volumes() {
    let book = parse_book(
        "简介。\n\n第1卷\r\n\n1、诱惑力太大！\n正文。\n\n2、下一章\n正文。\n\n第2卷\n1、重新开始\n正文。",
        "书名",
    );
    let titles: Vec<&str> = book.chapters.iter().map(|c| c.title.as_str()).collect();
    assert_eq!(
        titles,
        vec![
            "前言",
            "第1卷",
            "1、诱惑力太大！",
            "2、下一章",
            "第2卷",
            "1、重新开始"
        ]
    );
    assert_eq!(book.chapters[1].kind, ChapterKind::Volume);
    assert_eq!(book.chapters[4].kind, ChapterKind::Volume);
}

#[test]
fn custom_patterns_split_chapters_and_volumes() {
    let book = parse_book_with_patterns(
        "卷一：起航\n第001话 起点\n正文。\n第002话 远行\n正文。\n卷二：归来\n第001话 重逢\n正文。",
        "书名",
        Some(r"^第\d+话\s+.+$"),
        Some(r"^卷[一二]：.+$"),
    )
    .unwrap();
    assert_eq!(
        book.chapters
            .iter()
            .map(|c| c.title.as_str())
            .collect::<Vec<_>>(),
        vec![
            "卷一：起航",
            "第001话 起点",
            "第002话 远行",
            "卷二：归来",
            "第001话 重逢"
        ]
    );
    assert_eq!(book.chapters[3].kind, ChapterKind::Volume);
    assert!(parse_book_with_patterns("正文", "书名", Some("["), None).is_err());
}
