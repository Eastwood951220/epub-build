import type { EmbeddedFont } from '../book/model'
import type { AssetData, AssetSummary } from '../platform/backend'

export function sharedFontFamily(id: number): string {
  return `EPUBStudioLibraryFont${id}`
}

export function fontOptions(
  defaults: { value: string; label: string }[],
  embedded: EmbeddedFont[],
  library: AssetSummary[],
  imported: { value: string; label: string }[] = [],
): { value: string; label: string }[] {
  const choices = [...defaults, ...embedded.map(font => ({ value: font.family, label: font.name })),
    ...library.filter(asset => asset.kind === 'font').map(asset => ({ value: sharedFontFamily(asset.id), label: asset.name })), ...imported]
  const seen = new Set<string>()
  return choices.filter(choice => {
    if (seen.has(choice.value)) return false
    seen.add(choice.value)
    return true
  })
}

export async function prepareFontSelection(
  family: string,
  embedded: EmbeddedFont[],
  library: AssetSummary[],
  read: (id: number) => Promise<AssetData>,
): Promise<EmbeddedFont | null> {
  if (embedded.some(font => font.family === family)) return null
  const asset = library.find(item => item.kind === 'font' && sharedFontFamily(item.id) === family)
  if (!asset) return null
  const data = await read(asset.id)
  if (data.kind !== 'font') throw new Error('资源不是字体')
  return { family, name: data.name, mime: data.mime, dataUri: data.dataUri }
}
