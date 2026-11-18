use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{fs, path::Path, time::Duration};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSummary {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub mime: String,
    pub data_uri: String,
}

pub struct AssetStore(Connection);

impl AssetStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建资源库目录失败：{e}"))?;
        }
        let connection = Connection::open(path).map_err(|e| format!("打开资源库失败：{e}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL CHECK (kind IN ('font', 'image')),
            name TEXT NOT NULL,
            mime TEXT NOT NULL,
            content BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        ); CREATE INDEX IF NOT EXISTS assets_by_kind ON assets(kind, id);
           CREATE INDEX IF NOT EXISTS assets_by_kind_size ON assets(kind, length(content));
           CREATE TABLE IF NOT EXISTS asset_library_revision (
             id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL
           );
           INSERT OR IGNORE INTO asset_library_revision(id, revision) VALUES (1, 0);",
            )
            .map_err(|e| format!("初始化资源库失败：{e}"))?;
        Ok(Self(connection))
    }

    pub fn import_file(&self, path: &Path, kind: &str) -> Result<AssetSummary, String> {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match (kind, extension.as_str()) {
            ("font", "ttf") => "font/ttf",
            ("font", "otf") => "font/otf",
            ("font", "woff") => "font/woff",
            ("font", "woff2") => "font/woff2",
            ("image", "png") => "image/png",
            ("image", "jpg" | "jpeg") => "image/jpeg",
            ("image", "gif") => "image/gif",
            ("image", "webp") => "image/webp",
            ("image", "svg") => "image/svg+xml",
            _ => return Err("仅支持 TTF、OTF、WOFF、WOFF2 字体或 PNG、JPEG、GIF、WebP、SVG 图片".into()),
        };
        let content = fs::read(path).map_err(|e| format!("读取资源失败：{e}"))?;
        if content.is_empty() {
            return Err("资源文件为空".into());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        self.0
            .execute(
                "INSERT INTO assets(kind,name,mime,content) VALUES (?1,?2,?3,?4)",
                params![kind, name, mime, content],
            )
            .map_err(|e| format!("导入资源失败：{e}"))?;
        self.bump_revision()?;
        Ok(AssetSummary {
            id: self.0.last_insert_rowid(),
            kind: kind.into(),
            name,
            mime: mime.into(),
            size: content.len() as i64,
        })
    }

    /// Copies bytes into the shared library, reusing an identical entry instead
    /// of storing the same font or picture twice. Used when a project's own
    /// assets are extracted so the operation stays idempotent.
    pub fn import_data(
        &self,
        kind: &str,
        name: &str,
        mime: &str,
        content: &[u8],
    ) -> Result<(AssetSummary, bool), String> {
        if !matches!(kind, "font" | "image") {
            return Err("资源类型无效".into());
        }
        if content.is_empty() {
            return Err("资源文件为空".into());
        }
        if let Some(existing) = self.find_content(kind, content)? {
            return Ok((self.summary(existing)?, false));
        }
        self.0
            .execute(
                "INSERT INTO assets(kind,name,mime,content) VALUES (?1,?2,?3,?4)",
                params![kind, name, mime, content],
            )
            .map_err(|e| format!("导入资源失败：{e}"))?;
        self.bump_revision()?;
        let id = self.0.last_insert_rowid();
        Ok((
            AssetSummary {
                id,
                kind: kind.into(),
                name: name.into(),
                mime: mime.into(),
                size: content.len() as i64,
            },
            true,
        ))
    }

    /// Whether the library already holds these exact bytes for this kind.
    pub fn contains_content(&self, kind: &str, content: &[u8]) -> Result<bool, String> {
        Ok(self.find_content(kind, content)?.is_some())
    }

    pub fn revision(&self) -> Result<i64, String> {
        self.0.query_row("SELECT revision FROM asset_library_revision WHERE id=1", [], |row| row.get(0))
            .map_err(|e| e.to_string())
    }

    fn bump_revision(&self) -> Result<(), String> {
        self.0.execute("UPDATE asset_library_revision SET revision=revision+1 WHERE id=1", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn find_content(&self, kind: &str, content: &[u8]) -> Result<Option<i64>, String> {
        self.0
            .query_row(
                "SELECT id FROM assets WHERE kind=?1 AND length(content)=?2 AND content=?3 LIMIT 1",
                params![kind, content.len() as i64, content],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    fn summary(&self, id: i64) -> Result<AssetSummary, String> {
        self.0
            .query_row(
                "SELECT id,kind,name,mime,length(content) FROM assets WHERE id=?1",
                [id],
                |row| {
                    Ok(AssetSummary {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        name: row.get(2)?,
                        mime: row.get(3)?,
                        size: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "资源不存在".to_string())
    }

    pub fn list(&self, kind: &str) -> Result<Vec<AssetSummary>, String> {
        if !matches!(kind, "font" | "image") {
            return Err("资源类型无效".into());
        }
        let mut statement = self.0.prepare("SELECT id,kind,name,mime,length(content) FROM assets WHERE kind=?1 ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        statement
            .query_map([kind], |row| {
                Ok(AssetSummary {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    name: row.get(2)?,
                    mime: row.get(3)?,
                    size: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get(&self, id: i64) -> Result<AssetData, String> {
        let asset = self
            .0
            .query_row(
                "SELECT kind,name,mime,content FROM assets WHERE id=?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("资源不存在")?;
        Ok(AssetData {
            id,
            kind: asset.0,
            name: asset.1,
            mime: asset.2.clone(),
            data_uri: format!("data:{};base64,{}", asset.2, STANDARD.encode(asset.3)),
        })
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let deleted = self.0
            .execute("DELETE FROM assets WHERE id=?1", [id])
            .map_err(|e| format!("删除资源失败：{e}"))?;
        if deleted > 0 { self.bump_revision()?; }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_webp_into_shared_image_library() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.webp");
        fs::write(&path, b"RIFF\x04\0\0\0WEBP").unwrap();
        let store = AssetStore::open(&dir.path().join("assets.sqlite3")).unwrap();
        let summary = store.import_file(&path, "image").unwrap();
        assert_eq!(summary.mime, "image/webp");
        assert_eq!(store.get(summary.id).unwrap().data_uri, "data:image/webp;base64,UklGRgQAAABXRUJQ");
    }

    #[test]
    fn content_lookup_checks_bytes_even_when_sizes_match() {
        let dir = tempfile::tempdir().unwrap();
        let store = AssetStore::open(&dir.path().join("assets.sqlite3")).unwrap();
        store.import_data("image", "first.png", "image/png", b"abcd").unwrap();
        assert!(store.contains_content("image", b"abcd").unwrap());
        assert!(!store.contains_content("image", b"wxyz").unwrap());
        assert!(!store.contains_content("font", b"abcd").unwrap());
    }
}
