pub mod assets;
pub mod cache;
pub mod project;
pub mod project_assets;
pub mod txt;
pub mod workspace;

use std::path::PathBuf;
use tauri::Manager;

/// Projects and shared assets live in the platform app-data directory.
fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Preview cache lives in the user's Documents folder (see `cache::default_root`).
fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = app.path().document_dir().ok();
    Ok(cache::default_root(documents.as_deref(), &app_data_dir(app)?))
}

fn asset_store(app: &tauri::AppHandle) -> Result<assets::AssetStore, String> {
    assets::AssetStore::open(&app_data_dir(app)?.join("assets.sqlite3"))
}

fn cache_store(app: &tauri::AppHandle) -> Result<cache::CacheStore, String> {
    cache::CacheStore::open(cache_root(app)?)
}

fn workspace_store(app: &tauri::AppHandle) -> Result<workspace::WorkspaceStore, String> {
    workspace::WorkspaceStore::open(&app_data_dir(app)?.join("assets.sqlite3"))
}

#[tauri::command]
fn list_workspaces(app: tauri::AppHandle) -> Result<Vec<workspace::WorkspaceSummary>, String> {
    workspace_store(&app)?.list()
}

#[tauri::command]
fn create_workspace(
    app: tauri::AppHandle,
    book: project::Project,
) -> Result<workspace::WorkspaceSummary, String> {
    workspace_store(&app)?.create(&book)
}

#[tauri::command]
fn load_workspace(app: tauri::AppHandle, id: i64) -> Result<project::Project, String> {
    workspace_store(&app)?.load(id)
}

#[tauri::command]
fn save_workspace(app: tauri::AppHandle, id: i64, book: project::Project) -> Result<(), String> {
    workspace_store(&app)?.save(id, &book)
}

#[tauri::command]
fn delete_workspace(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    workspace_store(&app)?.delete(id)
}

#[tauri::command]
fn list_assets(app: tauri::AppHandle, kind: String) -> Result<Vec<assets::AssetSummary>, String> {
    asset_store(&app)?.list(&kind)
}

#[tauri::command]
fn import_asset(
    app: tauri::AppHandle,
    path: String,
    kind: String,
) -> Result<assets::AssetSummary, String> {
    asset_store(&app)?.import_file(std::path::Path::new(&path), &kind)
}

#[tauri::command]
fn get_asset(app: tauri::AppHandle, id: i64) -> Result<assets::AssetData, String> {
    asset_store(&app)?.get(id)
}

#[tauri::command]
fn delete_asset(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    asset_store(&app)?.delete(id)
}

/// Where the app keeps its data, shown by the settings dialog.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoragePaths {
    data_dir: String,
    database: String,
    cache_dir: String,
    documents_dir: String,
    /// True while the cache sits in Documents rather than the fallback folder.
    cache_in_documents: bool,
    version: String,
}

#[tauri::command]
fn storage_paths(app: tauri::AppHandle) -> Result<StoragePaths, String> {
    let data_dir = app_data_dir(&app)?;
    let documents = app.path().document_dir().ok();
    let cache_dir = cache::default_root(documents.as_deref(), &data_dir);
    Ok(StoragePaths {
        database: data_dir.join("assets.sqlite3").to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        cache_dir: cache_dir.to_string_lossy().into_owned(),
        documents_dir: documents
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        cache_in_documents: documents.is_some(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn reveal_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    cache::reveal_path(&app_data_dir(&app)?)
}

#[tauri::command]
fn cache_stats(app: tauri::AppHandle) -> Result<cache::CacheStats, String> {
    cache_store(&app)?.stats()
}

#[tauri::command]
fn cache_clear(app: tauri::AppHandle) -> Result<u64, String> {
    cache_store(&app)?.clear()
}

#[tauri::command]
fn cache_reveal(app: tauri::AppHandle) -> Result<(), String> {
    cache_store(&app)?.reveal()
}

#[tauri::command]
async fn list_project_assets(
    app: tauri::AppHandle,
    project_id: i64,
) -> Result<project_assets::ProjectAssetGroup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_assets::list(&workspace_store(&app)?, &asset_store(&app)?, project_id)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_project_asset(
    app: tauri::AppHandle,
    project_id: i64,
    key: String,
) -> Result<project_assets::ProjectAssetData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_assets::read(&workspace_store(&app)?, project_id, &key, Some(&cache_store(&app)?))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn extract_project_asset(
    app: tauri::AppHandle,
    project_id: i64,
    key: String,
) -> Result<assets::AssetSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_assets::extract(
            &workspace_store(&app)?,
            &asset_store(&app)?,
            project_id,
            &key,
            Some(&cache_store(&app)?),
        )
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn import_book(path: String) -> Result<project::Project, String> {
    project::import_book(std::path::Path::new(&path))
}

#[tauri::command]
fn redetect_txt(
    path: String,
    chapter_pattern: Option<String>,
    volume_pattern: Option<String>,
) -> Result<project::Project, String> {
    let path = std::path::Path::new(&path);
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("txt"))
    {
        return Err("只能重新识别 TXT 文件".into());
    }
    project::import_txt_with_patterns(path, chapter_pattern.as_deref(), volume_pattern.as_deref())
}

#[tauri::command]
fn load_project(path: String) -> Result<project::Project, String> {
    project::load_project(std::path::Path::new(&path))
}

#[tauri::command]
fn save_project(path: String, book: project::Project) -> Result<(), String> {
    project::save_project(&book, std::path::Path::new(&path))
}

#[tauri::command]
fn export_epub(path: String, book: project::Project) -> Result<(), String> {
    project::export_epub(&book, std::path::Path::new(&path))
}

#[tauri::command]
fn read_image(path: String) -> Result<String, String> {
    project::read_image(std::path::Path::new(&path))
}

#[tauri::command]
async fn download_image(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || project::download_image(&url))
        .await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Create the preview cache folder up front so it exists in Documents
            // even before the first image/font is previewed.
            if let Ok(root) = cache_root(app.handle()) {
                let _ = std::fs::create_dir_all(&root);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_book,
            redetect_txt,
            load_project,
            save_project,
            export_epub,
            read_image,
            download_image,
            list_assets,
            import_asset,
            get_asset,
            delete_asset,
            list_project_assets,
            read_project_asset,
            extract_project_asset,
            cache_stats,
            cache_clear,
            cache_reveal,
            storage_paths,
            reveal_data_dir,
            list_workspaces,
            create_workspace,
            load_workspace,
            save_workspace,
            delete_workspace
        ])
        .run(tauri::generate_context!())
        .expect("failed to run EPUB Studio");
}
