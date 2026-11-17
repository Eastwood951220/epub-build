import { describe, expect, it } from 'vitest'
import { createSaveQueue } from './saveQueue'

describe('workspace save queue', () => {
  it('waits for an older save before starting a newer one', async () => {
    let finishFirst!: () => void
    const firstDone = new Promise<void>(resolve => { finishFirst = resolve })
    const calls: string[] = []
    const enqueue = createSaveQueue()
    const first = enqueue(async () => { calls.push('first'); await firstDone })
    const second = enqueue(async () => { calls.push('second') })
    await Promise.resolve()
    expect(calls).toEqual(['first'])
    finishFirst()
    await Promise.all([first, second])
    expect(calls).toEqual(['first', 'second'])
  })
})
