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
  importBook: (path: string) => invoke<Project>('import_book', { path }),
  redetectTxt: (path: string, chapterPattern?: string, volumePattern?: string) =>
    invoke<Project>('redetect_txt', { path, chapterPattern, volumePattern }),
  loadProject: (path: string) => invoke<Project>('load_project', { path }),
  saveProject: (path: string, book: Project) => invoke<void>('save_project', { path, book }),
  exportEpub: (path: string, book: Project) => invoke<void>('export_epub', { path, book }),
  readImage: (path: string) => invoke<string>('read_image', { path }),
  downloadImage: (url: string) => invoke<string>('download_image', { url }),
}
