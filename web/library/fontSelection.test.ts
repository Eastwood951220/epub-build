import { describe, expect, it } from 'vitest'
import type { EmbeddedFont } from '../book/model'
import type { AssetSummary } from '../platform/backend'
import { fontOptions, prepareFontSelection, sharedFontFamily } from './fontSelection'

const shared: AssetSummary = { id: 1, kind: 'font', name: '书宋.ttf', mime: 'font/ttf', size: 128 }
const existing: EmbeddedFont = { family: 'EPUBStudioFont1', name: '工程自带字体.otf', mime: 'font/otf', dataUri: 'data:font/otf;base64,YQ==' }

describe('shared font selection', () => {
  it('lists library fonts alongside project fonts without reusing an imported EPUB family', () => {
    expect(sharedFontFamily(shared.id)).toBe('EPUBStudioLibraryFont1')
    expect(fontOptions([{ value: 'serif', label: '衬线字体' }], [existing], [shared])).toEqual([
      { value: 'serif', label: '衬线字体' },
      { value: existing.family, label: existing.name },
      { value: 'EPUBStudioLibraryFont1', label: shared.name },
    ])
  })

  it('loads a library font only when first selected for the project', async () => {
    let reads = 0
    const read = async () => {
      reads++
      return { id: 1, kind: 'font' as const, name: shared.name, mime: shared.mime, dataUri: 'data:font/ttf;base64,YQ==' }
    }
    const attached = await prepareFontSelection('EPUBStudioLibraryFont1', [existing], [shared], read)
    expect(attached).toEqual({ family: 'EPUBStudioLibraryFont1', name: shared.name, mime: shared.mime, dataUri: 'data:font/ttf;base64,YQ==' })
    expect(await prepareFontSelection('EPUBStudioLibraryFont1', [existing, attached!], [shared], read)).toBeNull()
    expect(reads).toBe(1)
  })
})
