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
        ); CREATE INDEX IF NOT EXISTS assets_by_kind ON assets(kind, id);",
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
            ("image", "svg") => "image/svg+xml",
            _ => return Err("仅支持 TTF、OTF、WOFF、WOFF2 字体或 PNG、JPEG、GIF、SVG 图片".into()),
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
        Ok(AssetSummary {
            id: self.0.last_insert_rowid(),
            kind: kind.into(),
            name,
            mime: mime.into(),
            size: content.len() as i64,
        })
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
        self.0
            .execute("DELETE FROM assets WHERE id=?1", [id])
            .map_err(|e| format!("删除资源失败：{e}"))?;
        Ok(())
    }
}
