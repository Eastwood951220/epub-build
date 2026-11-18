import { invoke } from '@tauri-apps/api/core'
import type { Project } from '../book/model'

export interface WorkspaceSummary {
  id: number
  title: string
  author: string
  chapterCount: number
  coverImage: string | null
  updatedAt: string
}

export type AssetKind = 'font' | 'image'
export interface AssetSummary { id: number; kind: AssetKind; name: string; mime: string; size: number }
export interface AssetData { id: number; kind: AssetKind; name: string; mime: string; dataUri: string }

/** A font or picture already embedded in one project, before it is shared. */
export interface ProjectAssetRef {
  /** Content fingerprint, stable while the bytes stay the same. */
  key: string
  name: string
  mime: string
  size: number
  /** True once identical bytes already sit in the shared library. */
  inLibrary: boolean
}
export interface ProjectAssetGroup {
  projectId: number
  projectTitle: string
  fonts: ProjectAssetRef[]
  images: ProjectAssetRef[]
}
export interface ProjectAssetData { key: string; name: string; mime: string; dataUri: string }

/** Where the app keeps its data, shown by the settings dialog. */
export interface StoragePaths {
  dataDir: string
  database: string
  cacheDir: string
  documentsDir: string
  /** True while the preview cache sits in Documents rather than a fallback. */
  cacheInDocuments: boolean
  version: string
}

/** Disposable preview cache; clearing it never touches library or projects. */
export interface CacheUsage { files: number; bytes: number }
export interface CacheStats {
  path: string
  totalFiles: number
  totalBytes: number
  fonts: CacheUsage
  images: CacheUsage
}

/** The desktop command contract used by the editor and bookshelf. */
export const backend = {
  listWorkspaces: () => invoke<WorkspaceSummary[]>('list_workspaces'),
  createWorkspace: (book: Project) => invoke<WorkspaceSummary>('create_workspace', { book }),
  loadWorkspace: (id: number) => invoke<Project>('load_workspace', { id }),
  saveWorkspace: (id: number, book: Project) => invoke<void>('save_workspace', { id, book }),
  deleteWorkspace: (id: number) => invoke<void>('delete_workspace', { id }),
  listAssets: (kind: AssetKind) => invoke<AssetSummary[]>('list_assets', { kind }),
  importAsset: (path: string, kind: AssetKind) => invoke<AssetSummary>('import_asset', { path, kind }),
  getAsset: (id: number) => invoke<AssetData>('get_asset', { id }),
  deleteAsset: (id: number) => invoke<void>('delete_asset', { id }),
  listProjectAssets: (projectId: number) => invoke<ProjectAssetGroup>('list_project_assets', { projectId }),
  readProjectAsset: (projectId: number, key: string) =>
    invoke<ProjectAssetData>('read_project_asset', { projectId, key }),
  extractProjectAsset: (projectId: number, key: string) =>
    invoke<AssetSummary>('extract_project_asset', { projectId, key }),
  storagePaths: () => invoke<StoragePaths>('storage_paths'),
  revealDataDir: () => invoke<void>('reveal_data_dir'),
  cacheStats: () => invoke<CacheStats>('cache_stats'),
  cacheClear: () => invoke<number>('cache_clear'),
  cacheReveal: () => invoke<void>('cache_reveal'),
  importBook: (path: string) => invoke<Project>('import_book', { path }),
  redetectTxt: (path: string, chapterPattern?: string, volumePattern?: string) =>
    invoke<Project>('redetect_txt', { path, chapterPattern, volumePattern }),
  loadProject: (path: string) => invoke<Project>('load_project', { path }),
  saveProject: (path: string, book: Project) => invoke<void>('save_project', { path, book }),
  exportEpub: (path: string, book: Project) => invoke<void>('export_epub', { path, book }),
  readImage: (path: string) => invoke<string>('read_image', { path }),
  downloadImage: (url: string) => invoke<string>('download_image', { url }),
}
