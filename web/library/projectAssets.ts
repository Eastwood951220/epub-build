import type { AssetKind, ProjectAssetRef } from '../platform/backend'

/** The kind's label used in headings, buttons and notices. */
export function kindLabel(kind: AssetKind): string {
  return kind === 'font' ? '字体' : '图片'
}

/**
 * Only entries still missing from the shared library. Bulk actions skip the
 * rest so a second click cannot re-copy what is already shared.
 */
export function pendingAssets(items: ProjectAssetRef[]): ProjectAssetRef[] {
  return items.filter(item => !item.inLibrary)
}

/** `PNG · 12 KB` caption shared by the library and per-project cards. */
export function assetMeta(asset: { mime: string; size: number }): string {
  const format = (asset.mime.split('/')[1] ?? asset.mime).split('+')[0].toUpperCase()
  const size =
    asset.size >= 1024 * 1024
      ? `${(asset.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(asset.size / 1024))} KB`
  return `${format} · ${size}`
}

/** Marks entries as shared after a successful extraction. */
export function markShared(
  group: { fonts: ProjectAssetRef[]; images: ProjectAssetRef[] },
  kind: AssetKind,
  keys: string[],
): { fonts: ProjectAssetRef[]; images: ProjectAssetRef[] } {
  const shared = new Set(keys)
  const apply = (items: ProjectAssetRef[]) =>
    items.map(item => (shared.has(item.key) ? { ...item, inLibrary: true } : item))
  return kind === 'font'
    ? { ...group, fonts: apply(group.fonts) }
    : { ...group, images: apply(group.images) }
}
