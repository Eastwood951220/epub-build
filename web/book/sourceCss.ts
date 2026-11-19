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

/** Font faces backed by files retained from the imported EPUB. */
export function sourceFontOptions(stylesheets: SourceStylesheet[] = [], assets: SourceStyleAsset[] = []): { value: string; label: string }[] {
  const paths = new Set(assets.map(asset => asset.path))
  const families = new Set<string>()
  for (const stylesheet of stylesheets) {
    try {
      postcss.parse(stylesheet.css).walkAtRules('font-face', rule => {
        let family = ''
        let src = ''
        rule.walkDecls(declaration => {
          if (declaration.prop.toLowerCase() === 'font-family') family = declaration.value.trim().replace(/^['"]|['"]$/g, '')
          if (declaration.prop.toLowerCase() === 'src') src = declaration.value
        })
        const url = /url\(\s*['"]?([^)'\"]+)['"]?\s*\)/i.exec(src)?.[1]
        if (family && url && paths.has(resolvePath(stylesheet.path, url.trim()))) families.add(family)
      })
    } catch { /* The original text remains available for export. */ }
  }
  return [...families].map(value => ({ value, label: `${value}（原书）` }))
}

/** Applies an EPUB's CSS to book content without styling the editor chrome. */
export function scopeSourceCss(stylesheets: SourceStylesheet[] = [], assets: SourceStyleAsset[] = [], options: { suppressPageBackground?: boolean } = {}): string {
  const byPath = new Map(assets.map(asset => [asset.path, asset.dataUri]))
  return stylesheets.map(stylesheet => {
    try {
      const sheet = postcss.parse(stylesheet.css)
      sheet.walkAtRules(rule => { if (['import', 'charset', 'namespace'].includes(rule.name.toLowerCase())) rule.remove() })
      if (options.suppressPageBackground) sheet.walkRules(rule => {
        if (rule.selector.split(',').some(selector => /^(?:html|body|:root)$/i.test(selector.trim()))) {
          rule.walkDecls(declaration => {
            if (/^background(?:-|$)/i.test(declaration.prop) && declaration.prop.toLowerCase() !== 'background-color') declaration.remove()
          })
        }
      })
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
