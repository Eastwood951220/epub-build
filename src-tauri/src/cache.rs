//! A disposable on-disk cache for fonts and pictures the app has already
//! decoded. Browsing a project's resources copies the bytes here so the next
//! preview does not decode the whole book again; clearing it never touches the
//! shared library or any project.

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub const KINDS: [&str; 2] = ["font", "image"];

/// Folder the app creates inside the user's Documents directory.
pub const APP_FOLDER: &str = "EPUB Studio";

/// The cache lives inside Documents so it can be found and backed up like any
/// other file; the platform app-data directory is only a fallback for accounts
/// where Documents is unavailable (or on platforms without one).
pub fn default_root(documents: Option<&Path>, app_data: &Path) -> PathBuf {
    match documents {
        Some(documents) => documents.join(APP_FOLDER).join("cache"),
        None => app_data.join("cache"),
    }
}

/// Opens a folder in the system file manager.
pub fn reveal_path(path: &Path) -> Result<(), String> {
    let target = path.to_string_lossy().into_owned();
    let mut command = if cfg!(target_os = "windows") {
        Command::new("explorer")
    } else if cfg!(target_os = "macos") {
        Command::new("open")
    } else {
        Command::new("xdg-open")
    };
    command.arg(target).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    /// Absolute cache directory, shown so the user can find it in Finder.
    pub path: String,
    pub total_files: u64,
    pub total_bytes: u64,
    pub fonts: CacheUsage,
    pub images: CacheUsage,
}

pub struct CacheStore {
    root: PathBuf,
}

impl CacheStore {
    /// Opens (and creates) the cache rooted at `root`.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, String> {
        let root = root.into();
        for kind in KINDS {
            fs::create_dir_all(root.join(kind)).map_err(|error| error.to_string())?;
        }
        Ok(Self { root })
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    /// Keeps `bytes` under `kind/key` unless an identical copy is already there.
    pub fn put(&self, kind: &str, key: &str, bytes: &[u8]) -> Result<(), String> {
        if !KINDS.contains(&kind) {
            return Err(format!("未知的缓存类型：{kind}"));
        }
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("缓存键不合法".into());
        }
        if bytes.is_empty() {
            return Ok(());
        }
        let path = self.root.join(kind).join(key);
        if path.exists() {
            return Ok(());
        }
        // Write through a temporary file so a crash cannot leave a half entry.
        let temporary = path.with_extension("part");
        fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        fs::rename(&temporary, &path).map_err(|error| error.to_string())
    }

    pub fn stats(&self) -> Result<CacheStats, String> {
        let fonts = usage(&self.root.join("font"))?;
        let images = usage(&self.root.join("image"))?;
        Ok(CacheStats {
            path: self.root.to_string_lossy().into_owned(),
            total_files: fonts.files + images.files,
            total_bytes: fonts.bytes + images.bytes,
            fonts,
            images,
        })
    }

    /// Empties both kind directories and reports how many bytes were freed.
    pub fn clear(&self) -> Result<u64, String> {
        let mut freed = 0;
        for kind in KINDS {
            let directory = self.root.join(kind);
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            for entry in entries {
                let entry = entry.map_err(|error| error.to_string())?;
                let path = entry.path();
                let metadata = entry.metadata().map_err(|error| error.to_string())?;
                if metadata.is_dir() {
                    fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
                } else {
                    freed += metadata.len();
                    fs::remove_file(&path).map_err(|error| error.to_string())?;
                }
            }
            fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        }
        Ok(freed)
    }

    /// Opens the cache folder in the system file manager.
    pub fn reveal(&self) -> Result<(), String> {
        reveal_path(&self.root)
    }
}

fn usage(directory: &Path) -> Result<CacheUsage, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(CacheUsage::default()),
        Err(error) => return Err(error.to_string()),
    };
    let mut usage = CacheUsage::default();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                usage.files += 1;
                usage.bytes += metadata.len();
            }
        }
    }
    Ok(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_defaults_to_documents_and_falls_back_to_app_data() {
        let documents = Path::new("/Users/me/Documents");
        assert_eq!(
            default_root(Some(documents), Path::new("/tmp/app-data")),
            Path::new("/Users/me/Documents/EPUB Studio/cache")
        );
        assert_eq!(
            default_root(None, Path::new("/tmp/app-data")),
            Path::new("/tmp/app-data/cache")
        );
    }

    #[test]
    fn stores_one_copy_per_key_and_reports_usage() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CacheStore::open(directory.path().join("cache")).unwrap();
        cache.put("image", "abc123", b"picture").unwrap();
        cache.put("image", "abc123", b"picture").unwrap();
        cache.put("font", "def456", b"font").unwrap();

        let stats = cache.stats().unwrap();
        assert_eq!(stats.images.files, 1);
        assert_eq!(stats.images.bytes, 7);
        assert_eq!(stats.fonts.files, 1);
        assert_eq!(stats.total_files, 2);
        assert!(Path::new(&stats.path).ends_with("cache"));
        assert!(directory.path().join("cache/image/abc123").exists());
    }

    #[test]
    fn clearing_frees_everything_but_keeps_the_folders() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CacheStore::open(directory.path().join("cache")).unwrap();
        cache.put("image", "a1", b"12345").unwrap();
        cache.put("font", "b2", b"123").unwrap();

        assert_eq!(cache.clear().unwrap(), 8);
        let stats = cache.stats().unwrap();
        assert_eq!(stats.total_files, 0);
        assert_eq!(stats.total_bytes, 0);
        assert!(cache.path().join("image").is_dir());
    }

    #[test]
    fn rejects_unknown_kinds_and_path_keys() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CacheStore::open(directory.path().join("cache")).unwrap();
        assert!(cache.put("book", "a1", b"x").is_err());
        assert!(cache.put("image", "../escape", b"x").is_err());
        assert!(cache.put("image", "", b"x").is_err());
    }
}
