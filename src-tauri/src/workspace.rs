use crate::project::{Project, validate_project};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{fs, path::Path, time::Duration};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: i64,
    pub title: String,
    pub author: String,
    pub chapter_count: i64,
    pub cover_image: Option<String>,
    pub updated_at: String,
}

pub struct WorkspaceStore(Connection);

impl WorkspaceStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建工程目录失败：{e}"))?;
        }
        let connection = Connection::open(path).map_err(|e| format!("打开工程数据库失败：{e}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            chapter_count INTEGER NOT NULL,
            cover_image TEXT,
            book_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ); CREATE INDEX IF NOT EXISTS projects_recent ON projects(updated_at DESC, id DESC);
           CREATE TABLE IF NOT EXISTS project_asset_groups (
             project_id INTEGER PRIMARY KEY,
             project_updated_at TEXT NOT NULL,
             library_revision INTEGER NOT NULL,
             group_json TEXT NOT NULL
           );",
            )
            .map_err(|e| format!("初始化工程数据库失败：{e}"))?;
        let has_cover = connection
            .prepare("PRAGMA table_info(projects)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|name| name == "cover_image");
        if !has_cover {
            connection
                .execute("ALTER TABLE projects ADD COLUMN cover_image TEXT", [])
                .map_err(|e| format!("更新工程数据库失败：{e}"))?;
        }
        Ok(Self(connection))
    }

    pub fn create(&self, book: &Project) -> Result<WorkspaceSummary, String> {
        validate_project(book)?;
        let json = serde_json::to_string(book).map_err(|e| e.to_string())?;
        self.0.execute("INSERT INTO projects(title,author,chapter_count,cover_image,book_json) VALUES (?1,?2,?3,?4,?5)",
            params![book.title, book.author, book.chapters.len() as i64, book.cover_image, json])
            .map_err(|e| format!("创建工程失败：{e}"))?;
        self.summary(self.0.last_insert_rowid())
    }

    pub fn list(&self) -> Result<Vec<WorkspaceSummary>, String> {
        let mut statement = self.0.prepare("SELECT id,title,author,chapter_count,cover_image,updated_at FROM projects ORDER BY updated_at DESC,id DESC")
            .map_err(|e| e.to_string())?;
        statement
            .query_map([], |row| {
                Ok(WorkspaceSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    chapter_count: row.get(3)?,
                    cover_image: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn summary(&self, id: i64) -> Result<WorkspaceSummary, String> {
        self.0.query_row("SELECT id,title,author,chapter_count,cover_image,updated_at FROM projects WHERE id=?1", [id], |row| Ok(WorkspaceSummary {
            id: row.get(0)?, title: row.get(1)?, author: row.get(2)?, chapter_count: row.get(3)?, cover_image: row.get(4)?, updated_at: row.get(5)?,
        })).map_err(|e| e.to_string())
    }

    pub fn load(&self, id: i64) -> Result<Project, String> {
        let json: String = self
            .0
            .query_row("SELECT book_json FROM projects WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("工程不存在")?;
        let mut book: Project =
            serde_json::from_str(&json).map_err(|e| format!("工程数据无效：{e}"))?;
        book.migrate_chapter_images();
        validate_project(&book)?;
        Ok(book)
    }

    pub fn project_version(&self, id: i64) -> Result<String, String> {
        self.0.query_row("SELECT updated_at FROM projects WHERE id=?1", [id], |row| row.get(0))
            .optional().map_err(|e| e.to_string())?.ok_or_else(|| "工程不存在".into())
    }

    pub fn cached_asset_group(&self, id: i64, version: &str, library_revision: i64) -> Result<Option<String>, String> {
        self.0.query_row(
            "SELECT group_json FROM project_asset_groups WHERE project_id=?1 AND project_updated_at=?2 AND library_revision=?3",
            params![id, version, library_revision], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())
    }

    pub fn save_asset_group(&self, id: i64, version: &str, library_revision: i64, json: &str) -> Result<(), String> {
        // A save during the scan must not cache a directory for a newer book.
        self.0.execute(
            "INSERT OR REPLACE INTO project_asset_groups(project_id,project_updated_at,library_revision,group_json)
             SELECT id,updated_at,?3,?4 FROM projects WHERE id=?1 AND updated_at=?2",
            params![id, version, library_revision, json],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save(&self, id: i64, book: &Project) -> Result<(), String> {
        validate_project(book)?;
        let json = serde_json::to_string(book).map_err(|e| e.to_string())?;
        let updated = self.0.execute("UPDATE projects SET title=?1,author=?2,chapter_count=?3,cover_image=?4,book_json=?5,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?6",
            params![book.title, book.author, book.chapters.len() as i64, book.cover_image, json, id])
            .map_err(|e| format!("保存工程失败：{e}"))?;
        if updated == 0 {
            return Err("工程不存在".into());
        }
        self.0.execute("DELETE FROM project_asset_groups WHERE project_id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let deleted = self
            .0
            .execute("DELETE FROM projects WHERE id=?1", [id])
            .map_err(|e| format!("删除工程失败：{e}"))?;
        if deleted == 0 {
            return Err("工程不存在".into());
        }
        self.0.execute("DELETE FROM project_asset_groups WHERE project_id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
