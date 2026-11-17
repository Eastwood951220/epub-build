import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import LibraryPanel, { type AssetData, type AssetKind, type AssetSummary } from './LibraryPanel'
import '../style.css'

const fonts: AssetSummary[] = [
  { id: 1, kind: 'font', name: 'SourceHanSerifSC-Heavy.otf', mime: 'font/otf', size: 8_612_864 },
  { id: 2, kind: 'font', name: '方正书宋简体.ttf', mime: 'font/ttf', size: 3_281_920 },
  { id: 3, kind: 'font', name: 'LXGWWenKai-Regular.woff2', mime: 'font/woff2', size: 1_845_248 },
]

const coverSvg = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#0d9488"/><rect x="38" y="38" width="524" height="724" fill="none" stroke="#d9f2ec" stroke-width="3"/><text x="300" y="360" font-size="64" fill="#eafff9" text-anchor="middle" font-family="serif">山海</text><text x="300" y="440" font-size="34" fill="#c4ece2" text-anchor="middle" font-family="serif">EPUB STUDIO</text></svg>`,
)}`

const images: AssetSummary[] = [
  { id: 11, kind: 'image', name: '封面-山海.png', mime: 'image/png', size: 430_080 },
  { id: 12, kind: 'image', name: '章首插图.jpg', mime: 'image/jpeg', size: 1_258_291 },
]

const fontPreview: AssetData = { id: 2, kind: 'font', name: '方正书宋简体.ttf', mime: 'font/ttf', dataUri: '' }
const imagePreview: AssetData = { id: 11, kind: 'image', name: '封面-山海.png', mime: 'image/png', dataUri: coverSvg }

function Demo({ startAssets, startKind, preview }: {
  startAssets: AssetSummary[]
  startKind: AssetKind
  preview: AssetData | null
}) {
  const [kind, setKind] = useState<AssetKind>(startKind)
  const [previewAsset, setPreviewAsset] = useState<AssetData | null>(preview)
  return (
    <LibraryPanel
      kind={kind}
      assets={startAssets.filter(asset => asset.kind === kind)}
      counts={{
        font: startAssets.filter(asset => asset.kind === 'font').length,
        image: startAssets.filter(asset => asset.kind === 'image').length,
      }}
      previewAsset={previewAsset}
      busy={false}
      editing
      onKindChange={next => { setKind(next); setPreviewAsset(null) }}
      onImport={() => {}}
      onDelete={() => {}}
      onPreview={() => {}}
      onClosePreview={() => setPreviewAsset(null)}
      onUseFont={() => {}}
      onUseImage={() => {}}
    />
  )
}

const corpus = [...fonts, ...images]
const cases = [
  { id: 'empty', title: '空状态', assets: [] as AssetSummary[], kind: 'font' as AssetKind, preview: null as AssetData | null },
  { id: 'font-list', title: '字体列表', assets: corpus, kind: 'font' as AssetKind, preview: null },
  { id: 'font-preview', title: '字体预览', assets: corpus, kind: 'font' as AssetKind, preview: fontPreview },
  { id: 'image-list', title: '图片列表', assets: corpus, kind: 'image' as AssetKind, preview: null },
  { id: 'image-preview', title: '图片预览', assets: corpus, kind: 'image' as AssetKind, preview: imagePreview },
]

function Preview() {
  return (
    <div className="lp-row">
      {cases.map(item => (
        <div className="lp-cell" key={item.id} data-case={item.id}>
          <span className="lp-cell-title">{item.title}</span>
          <div className="lp-case settings-panel">
            <Demo startAssets={item.assets} startKind={item.kind} preview={item.preview} />
          </div>
        </div>
      ))}
      <div className="lp-cell narrow" data-case="narrow">
        <span className="lp-cell-title">窄侧栏 234px</span>
        <div className="lp-case settings-panel">
          <Demo startAssets={corpus} startKind="font" preview={null} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
