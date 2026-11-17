export function createSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(save: () => Promise<T>): Promise<T> {
    const result = tail.then(save, save)
    tail = result.catch(() => {})
    return result
  }
}
