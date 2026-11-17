pub mod assets;
pub mod project;
pub mod txt;
pub mod workspace;

use tauri::Manager;

fn asset_store(app: &tauri::AppHandle) -> Result<assets::AssetStore, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    assets::AssetStore::open(&directory.join("assets.sqlite3"))
}

fn workspace_store(app: &tauri::AppHandle) -> Result<workspace::WorkspaceStore, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    workspace::WorkspaceStore::open(&directory.join("assets.sqlite3"))
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
            list_workspaces,
            create_workspace,
            load_workspace,
            save_workspace,
            delete_workspace
        ])
        .run(tauri::generate_context!())
        .expect("failed to run EPUB Studio");
}
