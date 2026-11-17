import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import App from './App'
import './style.css'

// macOS 窗口使用 titleBarStyle: Overlay，网页内容延伸到原生标题栏下方，
// 需要给顶部栏让出 28px 的红绿灯区域；Windows 保留系统标题栏，不需要让位。
if (/Mac OS X|Macintosh/.test(navigator.userAgent)) document.documentElement.classList.add('mac')

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
