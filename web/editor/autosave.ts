/** 自动保存节拍：每 30 秒检查一次有没有未落盘的改动。 */
export const AUTOSAVE_INTERVAL_MS = 30_000

export interface AutosaveState {
  /** 正在编辑器里编辑某个已存盘的工程 */
  attached: boolean
  /** 有尚未写回工程的改动 */
  dirty: boolean
  /** 正有别的耗时操作，先让开 */
  busy: boolean
  /** 上一次自动保存还没返回 */
  saving: boolean
}

/** 定时器每跳一次，是否真的应该写盘。 */
export function shouldAutosave({ attached, dirty, busy, saving }: AutosaveState): boolean {
  return attached && dirty && !busy && !saving
}
