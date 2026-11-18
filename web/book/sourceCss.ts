import postcss from 'postcss'
import type { SourceStyleAsset, SourceStylesheet } from './model'

const ROOTS = ['.chapter-editor .ProseMirror', '.preview-content']

function resolvePath(base: string, reference: string): string {
  const decoded = (() => { try { return decodeURIComponent(reference.split(/[?#]/, 1)[0]) } catch { return reference } })()
  const parts = [...base.split('/').slice(0, -1), ...decoded.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '..') normalized.pop()
    else if (part && part !== '.') normalized.push(part)
  }
  return normalized.join('/')
}

function scopedSelector(selector: string, root: string): string {
  const trimmed = selector.trim()
  const withoutRoot = trimmed.replace(/^(?:(?:html|body|:root)\s*)+/i, '').trim()
  if (!withoutRoot) return root
  if (/^(?:html|body|:root)(?=[.#[:])/i.test(trimmed)) return root + trimmed.replace(/^(?:html|body|:root)/i, '')
  return `${root} ${withoutRoot}`
}

/** Applies an EPUB's CSS to book content without styling the editor chrome. */
export function scopeSourceCss(stylesheets: SourceStylesheet[] = [], assets: SourceStyleAsset[] = []): string {
  const byPath = new Map(assets.map(asset => [asset.path, asset.dataUri]))
  return stylesheets.map(stylesheet => {
    try {
      const sheet = postcss.parse(stylesheet.css)
      sheet.walkAtRules(rule => { if (['import', 'charset', 'namespace'].includes(rule.name.toLowerCase())) rule.remove() })
      sheet.walkDecls(declaration => {
        declaration.value = declaration.value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_whole, _quote: string, url: string) => {
          if (url.startsWith('#') || /^(?:data:image\/|data:font\/)/i.test(url)) return `url("${url}")`
          const data = byPath.get(resolvePath(stylesheet.path, url))
          return data ? `url("${data}")` : 'none'
        })
      })
      sheet.walkRules(rule => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
        rule.selector = rule.selector.split(',').flatMap(selector => ROOTS.map(root => scopedSelector(selector, root))).join(',')
      })
      return sheet.toString()
    } catch {
      return ''
    }
  }).join('\n')
}
