import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import SettingsDialog from './SettingsDialog'

describe('app settings dialog', () => {
  it('offers the about, general and cache tabs', () => {
    const html = renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }))
    expect(html).toContain('aria-labelledby="settings-title"')
    expect(html).toContain('说明')
    expect(html).toContain('通用')
    expect(html).toContain('缓存')
    expect(html).toContain('aria-controls="settings-panel-cache"')
  })

  it('explains where projects, shared fonts and pictures end up', () => {
    const html = renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }))
    expect(html).toContain('工程')
    expect(html).toContain('字体库')
    expect(html).toContain('图片库')
    expect(html).toContain('不会上传到云端')
  })
})
