import type { BookStyle, HeadingLineStyle } from './model'

export type HeadingStyleKey = 'chapterNumberStyle' | 'chapterNameStyle' | 'volumeNumberStyle' | 'volumeNameStyle'

export default function HeadingStyleControls({ label, styleKey, style, fonts, onChange }: {
  label: string
  styleKey: HeadingStyleKey
  style: BookStyle
  fonts: { value: string; label: string }[]
  onChange: (key: HeadingStyleKey, patch: Partial<HeadingLineStyle>) => void
}) {
  const current = style[styleKey] ?? {}
  const number = styleKey.endsWith('NumberStyle')
  return <section className="setting-section heading-style-section">
    <h3>{label}</h3>
    <label>字体<select value={current.fontFamily ?? style.titleFontFamily} onChange={event => onChange(styleKey, { fontFamily: event.target.value })}>{fonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
    <div className="field-row">
      <label>字号<input type="number" min="12" max="72" value={current.fontSize ?? (number ? Math.round(style.titleFontSize * 0.65) : style.titleFontSize)} onChange={event => onChange(styleKey, { fontSize: Number(event.target.value) })}/></label>
      <label>颜色<input type="color" value={current.color ?? (number ? '#587670' : '#183e37')} onChange={event => onChange(styleKey, { color: event.target.value })}/></label>
    </div>
    <div className="field-row">
      <label>对齐<select value={current.align ?? style.titleAlign} onChange={event => onChange(styleKey, { align: event.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
      <label>字重<select value={current.weight ?? (number ? 650 : 700)} onChange={event => onChange(styleKey, { weight: Number(event.target.value) })}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="650">较粗</option><option value="700">粗体</option><option value="800">特粗</option></select></label>
    </div>
  </section>
}
