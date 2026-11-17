import { describe, expect, it } from 'vitest'
import { AUTOSAVE_INTERVAL_MS, shouldAutosave } from './autosave'

const ready = { attached: true, dirty: true, busy: false, saving: false }

describe('project autosave', () => {
  it('waits 30 seconds between checks', () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(30_000)
  })

  it('writes a project that has unsaved edits', () => {
    expect(shouldAutosave(ready)).toBe(true)
  })

  it('leaves a clean project alone so the timer does not rewrite it', () => {
    expect(shouldAutosave({ ...ready, dirty: false })).toBe(false)
  })

  it('does not stack writes while another save is in flight', () => {
    expect(shouldAutosave({ ...ready, saving: true })).toBe(false)
  })

  it('stands aside while a slower action like export is running', () => {
    expect(shouldAutosave({ ...ready, busy: true })).toBe(false)
  })

  it('stays idle when no project is open', () => {
    expect(shouldAutosave({ ...ready, attached: false })).toBe(false)
  })
})
