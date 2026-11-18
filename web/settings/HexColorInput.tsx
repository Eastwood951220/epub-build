import { useEffect, useState } from 'react'

export function parseHexColor(value: string): string | null {
  const digits = value.trim().replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(digits) ? `#${digits.toLowerCase()}` : null
}

export default function HexColorInput({ value, onChange, label }: {
  value: string
  onChange: (color: string) => void
  label: string
}) {
  const [draft, setDraft] = useState(value.replace(/^#/, ''))

  useEffect(() => setDraft(value.replace(/^#/, '')), [value])

  function commit() {
    const color = parseHexColor(draft)
    if (color) onChange(color)
    setDraft((color ?? value).replace(/^#/, ''))
  }

  return <span className="hex-color-input">
    <input type="color" value={parseHexColor(value) ?? '#000000'} aria-label={`${label}色板`} onChange={event => {
      setDraft(event.target.value.slice(1))
      onChange(event.target.value)
    }}/>
    <span className="hex-color-hash" aria-hidden="true">#</span>
    <input type="text" value={draft} aria-label={`${label}色值`} maxLength={7} spellCheck={false} autoComplete="off" inputMode="text" onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur()
    }}/>
  </span>
}
