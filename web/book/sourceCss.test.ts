import { describe, expect, it } from 'vitest'
import { scopeSourceCss, sourceFontOptions } from './sourceCss'

describe('imported EPUB CSS', () => {
  it('keeps class colours and embedded fonts inside chapter content', () => {
    const css = scopeSourceCss(
      [{ path: 'OEBPS/Styles/original.css', css: '@font-face{font-family:"Talk";src:url("../Fonts/talk.otf")} span.talk{font-family:"Talk";color:#863020} p.special{color:#456789} body{line-height:1.5}' }],
      [{ path: 'OEBPS/Fonts/talk.otf', mime: 'font/otf', dataUri: 'data:font/otf;base64,AA==' }],
    )
    expect(css).toContain('src:url("data:font/otf;base64,AA==")')
    expect(css).toContain('.chapter-editor .ProseMirror span.talk')
    expect(css).toContain('.preview-content span.talk')
    expect(css).toContain('.preview-content p.special')
    expect(css).toContain('.preview-content{line-height:1.5}')
  })

  it('does not allow imported rules to style the app shell', () => {
    const css = scopeSourceCss([{ path: 'a.css', css: '@import url("https://example.com/a.css"); p{color:red}' }], [])
    expect(css).not.toContain('@import')
    expect(css).not.toMatch(/(^|\})\s*p\s*\{/)
  })

  it('lets the chapter background setting control imported page images', () => {
    const css = scopeSourceCss(
      [{ path: 'OEBPS/Styles/original.css', css: 'body{background-image:url("../Images/paper.png");background-size:cover;color:#123456}span.talk{background:#ffeecc}' }],
      [{ path: 'OEBPS/Images/paper.png', mime: 'image/png', dataUri: 'data:image/png;base64,AA==' }],
      { suppressPageBackground: true },
    )
    expect(css).toContain('.preview-content{color:#123456}')
    expect(css).not.toContain('data:image/png')
    expect(css).toContain('span.talk{background:#ffeecc}')
  })

  it('lists embedded font families from the original CSS for local text styling', () => {
    const styles = [{ path: 'OEBPS/Styles/original.css', css: '@font-face{font-family:"风雨魏碑";src:url("../Fonts/talk.otf")}@font-face{font-family:"缺失字体";src:url("../Fonts/missing.ttf")}' }]
    const assets = [{ path: 'OEBPS/Fonts/talk.otf', mime: 'font/otf', dataUri: 'data:font/otf;base64,AA==' }]
    expect(sourceFontOptions(styles, assets)).toEqual([{ value: '风雨魏碑', label: '风雨魏碑（原书）' }])
  })
})
