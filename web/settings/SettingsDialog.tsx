import { useEffect, useRef, useState } from 'react'
import { backend, type StoragePaths } from '../platform/backend'
import { BookOpen, FolderOpen, HardDrive, Image as ImageIcon, Info, Settings2, Type, X } from 'lucide-react'
import CacheSettings from './CacheSettings'

type Tab = 'about' | 'general' | 'cache'

const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
  { id: 'about', label: '说明', icon: Info },
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'cache', label: '缓存', icon: HardDrive },
]

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** App-wide preferences, opened from the bookshelf header. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('about')
  const [paths, setPaths] = useState<StoragePaths | null>(null)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    backend.storagePaths().then(next => { if (active) setPaths(next) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function revealDataDir() {
    setError('')
    try { await backend.revealDataDir() } catch (cause) { setError(errorMessage(cause)) }
  }

  async function revealCache() {
    setError('')
    try { await backend.cacheReveal() } catch (cause) { setError(errorMessage(cause)) }
  }

  return <div className="books-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialog}>
      <div className="settings-dialog-head">
        <div><span>PREFERENCES</span><h2 id="settings-title">设置</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭设置"><X size={19}/></button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" id={`settings-tab-${id}`}
          aria-selected={tab === id} aria-controls={`settings-panel-${id}`}
          className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
          <Icon size={15}/>{label}
        </button>)}
      </div>
      <div className="settings-dialog-body" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {error && <p className="setting-error" role="alert">{error}</p>}
        {tab === 'about' ? <About/> : tab === 'general' ? <General paths={paths} onRevealData={revealDataDir} onRevealCache={revealCache}/> : <CacheSettings showHeading={false}/>}
      </div>
    </div>
  </div>
}

/** What the app does and where each kind of resource ends up. */
function About() {
  return <>
    <section className="setting-section">
      <h3>这个工具做什么</h3>
      <p className="settings-copy">EPUB Studio 把一本书的正文、排版、字体和插图都收在本机：导入 TXT / EPUB 后逐章校对、排版，最后导出成 EPUB。</p>
    </section>
    <section className="setting-section">
      <h3>资源放在哪里</h3>
      <ul className="settings-about-list">
        <li><BookOpen size={17}/><div><strong>工程</strong>每本书是一个工程，正文、排版和封面保存在本机数据库。</div></li>
        <li><Type size={17}/><div><strong>字体库</strong>公用字体所有工程都能用；书稿里已经内嵌的字体，可在首页「字体库」按工程提取一份到公用库。</div></li>
        <li><ImageIcon size={17}/><div><strong>图片库</strong>封面、章节图和正文插图按工程归类；提取只是复制一份，书稿本身不变。</div></li>
        <li><HardDrive size={17}/><div><strong>缓存</strong>预览过的字体和图片会留一份副本，加快下次打开，随时可以清理。</div></li>
      </ul>
    </section>
    <p className="settings-copy">所有数据都在本机，不会上传到云端。</p>
  </>
}

/** Storage locations and app version. */
function General({ paths, onRevealData, onRevealCache }: {
  paths: StoragePaths | null
  onRevealData: () => Promise<void>
  onRevealCache: () => Promise<void>
}) {
  return <>
    <section className="setting-section">
      <h3>数据存储</h3>
      <p className="setting-help">工程数据库和公用资源库在应用数据目录；预览缓存默认放在「文稿 / EPUB Studio / cache」。</p>
      <div className="path-list">
        <div><span>数据库</span><code>{paths?.database ?? '读取中…'}</code></div>
        <div><span>数据目录</span><code>{paths?.dataDir ?? '读取中…'}</code></div>
        <div><span>缓存目录</span><code>{paths?.cacheDir ?? '读取中…'}</code></div>
      </div>
      <div className="cache-actions">
        <button className="button outline" onClick={() => void onRevealData()} disabled={!paths}><FolderOpen size={15}/>打开数据目录</button>
        <button className="button outline" onClick={() => void onRevealCache()} disabled={!paths}><FolderOpen size={15}/>打开缓存目录</button>
      </div>
    </section>
    <section className="setting-section">
      <h3>关于</h3>
      <div className="cache-rows">
        <div className="cache-row"><span>版本</span><strong>{paths ? `v${paths.version}` : '—'}</strong></div>
        <div className="cache-row"><span>缓存位置</span><strong>{paths ? (paths.cacheInDocuments ? '文稿文件夹' : '应用数据目录') : '—'}</strong></div>
        <div className="cache-row"><span>数据归属</span><strong>仅本机</strong></div>
      </div>
    </section>
  </>
}
