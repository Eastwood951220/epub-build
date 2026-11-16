use epub_studio::{assets::AssetStore, project::import_book, workspace::WorkspaceStore};
use rusqlite::Connection;
use std::fs;
use tempfile::tempdir;

#[test]
fn projects_persist_independently_and_share_asset_library() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章 开始\n正文").unwrap();
    let mut first = import_book(&input).unwrap();
    first.title = "第一本".into();
    first.cover_image = Some("data:image/png;base64,iVBORw0KGgo=".into());
    let mut second = first.clone();
    second.title = "第二本".into();
    let database = dir.path().join("app/assets.sqlite3");
    let store = WorkspaceStore::open(&database).unwrap();
    let first_id = store.create(&first).unwrap().id;
    let second_id = store.create(&second).unwrap().id;
    first.chapters[0].html = "<p>修改后的正文</p>".into();
    store.save(first_id, &first).unwrap();
    drop(store);

    let store = WorkspaceStore::open(&database).unwrap();
    assert_eq!(store.list().unwrap().len(), 2);
    assert_eq!(
        store
            .list()
            .unwrap()
            .iter()
            .find(|item| item.id == first_id)
            .unwrap()
            .cover_image
            .as_deref(),
        Some("data:image/png;base64,iVBORw0KGgo=")
    );
    assert_eq!(
        store.load(first_id).unwrap().chapters[0].html,
        "<p>修改后的正文</p>"
    );
    assert_eq!(store.load(second_id).unwrap().title, "第二本");
    let font = dir.path().join("Shared.ttf");
    fs::write(&font, b"\0\x01\0\0font").unwrap();
    let assets = AssetStore::open(&database).unwrap();
    assets.import_file(&font, "font").unwrap();
    store.delete(first_id).unwrap();
    assert!(store.load(first_id).is_err());
    assert_eq!(store.list().unwrap().len(), 1);

    assert_eq!(assets.list("font").unwrap().len(), 1);
    assert_eq!(store.load(second_id).unwrap().title, "第二本");
}

#[test]
fn existing_project_table_gains_cover_without_losing_books() {
    let dir = tempdir().unwrap();
    let database = dir.path().join("assets.sqlite3");
    let connection = Connection::open(&database).unwrap();
    connection.execute_batch("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT NOT NULL, chapter_count INTEGER NOT NULL, book_json TEXT NOT NULL, updated_at TEXT NOT NULL);").unwrap();
    let input = dir.path().join("book.txt");
    fs::write(&input, "第一章\n正文").unwrap();
    let project = import_book(&input).unwrap();
    connection.execute("INSERT INTO projects(title,author,chapter_count,book_json,updated_at) VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params![project.title, project.author, 1, serde_json::to_string(&project).unwrap(), "2026-11-16T00:00:00Z"]).unwrap();
    drop(connection);

    let store = WorkspaceStore::open(&database).unwrap();
    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].cover_image.is_none());
    assert_eq!(store.load(listed[0].id).unwrap().chapters.len(), 1);
}
