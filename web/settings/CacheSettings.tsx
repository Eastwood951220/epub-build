import { useEffect, useState } from 'react'
import { backend, type CacheStats } from '../platform/backend'
import { HardDrive, RefreshCw, Trash2, FolderOpen } from 'lucide-react'
import { formatBytes } from './cacheFormat'

interface Overview {
  projects: number
  fonts: number
  images: number
  projectFonts: number
  projectImages: number
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** What the app keeps on disk and which resources each project carries. */
export default function CacheSettings({ showHeading = true }: { showHeading?: boolean }) {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    backend.cacheStats()
      .then(nextStats => { if (active) setStats(nextStats) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [])

  async function loadOverview(): Promise<Overview> {
    const [workspaces, fonts, images] = await Promise.all([
      backend.listWorkspaces(),
      backend.listAssets('font'),
      backend.listAssets('image'),
    ])
    // One unreadable project should not blank the whole overview.
    const groups = await Promise.all(workspaces.map(workspace =>
      backend.listProjectAssets(workspace.id).catch(() => null)))
    return {
      projects: workspaces.length,
      fonts: fonts.length,
      images: images.length,
      projectFonts: groups.reduce((sum, group) => sum + (group?.fonts.length ?? 0), 0),
      projectImages: groups.reduce((sum, group) => sum + (group?.images.length ?? 0), 0),
    }
  }

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      setStats(await backend.cacheStats())
      setNotice('已刷新')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function countProjectAssets() {
    setOverviewBusy(true)
    setError('')
    try {
      setOverview(await loadOverview())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setOverviewBusy(false)
    }
  }

  async function reveal() {
    setError('')
    try {
      await backend.cacheReveal()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function clear() {
    if (!window.confirm('清理预览缓存？这只删除预览用的副本，不会影响工程和公用资源库。')) return
    setBusy(true)
    setError('')
    try {
      const freed = await backend.cacheClear()
      setStats(await backend.cacheStats())
      setNotice(`已清理 ${formatBytes(freed)}`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <>
    {showHeading && <div className="panel-heading"><div><span className="eyebrow">本机存储</span><h2>缓存与记录</h2></div></div>}
    {error && <p className="setting-error" role="alert">{error}</p>}
    <section className="setting-section">
      <h3>预览缓存</h3>
      <p className="setting-help">浏览工程里的图片和字体时会留一份副本，加快再次预览。缓存放在「文稿 / EPUB Studio / cache」，随时可以清理，工程正文和公用资源库都不受影响。</p>
      <code className="cache-path" title={stats?.path}>{stats?.path ?? '读取中…'}</code>
      <div className="cache-rows">
        <div className="cache-row"><span>图片副本</span><strong>{stats ? `${stats.images.files} 个 · ${formatBytes(stats.images.bytes)}` : '—'}</strong></div>
        <div className="cache-row"><span>字体副本</span><strong>{stats ? `${stats.fonts.files} 个 · ${formatBytes(stats.fonts.bytes)}` : '—'}</strong></div>
        <div className="cache-row"><span>合计占用</span><strong>{stats ? formatBytes(stats.totalBytes) : '—'}</strong></div>
      </div>
      <div className="cache-actions">
        <button className="button outline" onClick={reveal} disabled={busy}><FolderOpen size={15}/>在文件夹中显示</button>
        <button className="button outline" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15}/>刷新</button>
        <button className="button subtle" onClick={() => void clear()} disabled={busy || !stats || stats.totalFiles === 0}><Trash2 size={15}/>清理缓存</button>
      </div>
      {notice && <p className="setting-help" role="status">{notice}</p>}
    </section>
    <section className="setting-section">
      <h3>工程资源记录</h3>
      <p className="setting-help">每个工程内嵌的字体和图片都已登记，可到首页字体库／图片库按工程查看并提取为公用资源。</p>
      <button className="button outline" onClick={() => void countProjectAssets()} disabled={overviewBusy}>
        <RefreshCw size={15}/>{overviewBusy ? '正在统计…' : overview ? '重新统计工程资源' : '统计工程资源'}
      </button>
      <div className="cache-rows">
        <div className="cache-row"><span>工程</span><strong>{overview ? `${overview.projects} 个` : '—'}</strong></div>
        <div className="cache-row"><span>公用字体 / 图片</span><strong>{overview ? `${overview.fonts} / ${overview.images}` : '—'}</strong></div>
        <div className="cache-row"><span>工程内嵌字体</span><strong>{overview ? `${overview.projectFonts} 项` : '—'}</strong></div>
        <div className="cache-row"><span>工程内嵌图片</span><strong>{overview ? `${overview.projectImages} 项` : '—'}</strong></div>
      </div>
      <p className="setting-help"><HardDrive size={13}/> 所有数据都在本机，不上传云端。</p>
    </section>
  </>
}
