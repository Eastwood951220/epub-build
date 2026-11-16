use epub_studio::assets::AssetStore;
use std::fs;
use tempfile::tempdir;

#[test]
fn imported_assets_survive_reopening_and_deletion() {
    let dir = tempdir().unwrap();
    let font = dir.path().join("Sample.ttf");
    let image = dir.path().join("cover.png");
    fs::write(&font, b"\0\x01\0\0font bytes").unwrap();
    fs::write(&image, b"\x89PNG\r\n\x1a\nimage bytes").unwrap();
    let database = dir.path().join("nested/assets.sqlite3");
    let store = AssetStore::open(&database).unwrap();
    let font_entry = store.import_file(&font, "font").unwrap();
    let image_entry = store.import_file(&image, "image").unwrap();
    drop(store);

    let store = AssetStore::open(&database).unwrap();
    assert_eq!(store.list("font").unwrap().len(), 1);
    assert_eq!(store.list("image").unwrap().len(), 1);
    assert_eq!(store.get(font_entry.id).unwrap().mime, "font/ttf");
    assert!(
        store
            .get(image_entry.id)
            .unwrap()
            .data_uri
            .starts_with("data:image/png;base64,")
    );
    store.delete(font_entry.id).unwrap();
    assert!(store.list("font").unwrap().is_empty());
    assert_eq!(store.list("image").unwrap().len(), 1);
    let next_font = store.import_file(&font, "font").unwrap();
    assert!(next_font.id > image_entry.id);
}
