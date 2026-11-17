import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

/** Empty titlebar space and its labels drag; controls retain their normal click action. */
export function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.detail !== 1) return
  if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,[role="button"]')) return
  event.preventDefault()
  void getCurrentWindow().startDragging().catch(() => {})
}
