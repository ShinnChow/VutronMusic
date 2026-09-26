import { BrowserWindow, shell, WebContents } from 'electron'
import Constants from './Constants'
import log from '../log'
import { trustWebContents, TrustedWindowKind } from './ipcGuard'

/**
 * 窗口导航锁（issue #416 的核心修复之一）。
 *
 * 背景：主窗口与桌面歌词窗口此前都没有注册 `will-navigate` /
 * `setWindowOpenHandler`，渲染进程里任意一个 http(s) 链接被点击，整个特权窗口
 * 就会导航到外部站点，preload 随之在新 origin 上重新执行，攻击者页面随即获得
 * `window.mainApi`。
 *
 * 本模块对所有窗口统一施加以下约束：
 *   - 主 frame 导航只允许停留在应用自身 origin；
 *   - 跨 origin 导航被拦截，并改用系统浏览器打开（仍走协议白名单）；
 *   - `window.open` / `target=_blank` 一律拒绝，同样降级到系统浏览器；
 *   - 禁止挂载 `<webview>`。
 */

/** 允许交给系统浏览器打开的协议 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 已加固过的 webContents，避免重复注册（重复注册会导致外链被打开两次） */
const lockedDown = new WeakSet<WebContents>()

export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(raw).protocol)
  } catch {
    return false
  }
}

/**
 * 用系统浏览器打开外部链接。这是应用内打开外链的**唯一**安全出口，
 * 非 http/https/mailto 协议一律拒绝。
 */
export function openExternalSafely(raw: unknown): void {
  if (!isSafeExternalUrl(raw)) {
    log.warn(`[security] 已拒绝打开非白名单协议的链接: ${String(raw)}`)
    return
  }
  shell.openExternal(raw).catch((err) => {
    log.warn(`[security] 打开外部链接失败: ${raw}`, err)
  })
}

export function isAppUrl(raw: string): boolean {
  try {
    return new URL(raw).origin === Constants.APP_ORIGIN
  } catch {
    return false
  }
}

/**
 * 对单个 webContents 施加导航约束。幂等。
 */
export function lockDownNavigation(contents: WebContents): void {
  if (lockedDown.has(contents)) return
  lockedDown.add(contents)

  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    log.warn(`[security] 已拦截窗口导航: ${url}`)
    openExternalSafely(url)
  })

  contents.on('will-redirect', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    log.warn(`[security] 已拦截窗口重定向: ${url}`)
  })

  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('[security] 已拦截 webview 挂载')
  })
}

/**
 * 登记可信窗口并施加导航约束。这是**唯一**允许赋予窗口 IPC 调用权限的入口，
 * 必须在 `new BrowserWindow()` 之后、`loadURL()` 之前调用。
 *
 * 不变量：新增任何窗口都必须经过本函数。未登记的窗口会被 `ipcGuard` 直接拒绝
 * 全部 IPC 调用（fail-closed），因此不存在「忘记加固却仍具备特权」的窗口。
 */
export function hardenWindow(win: BrowserWindow, kind: TrustedWindowKind): void {
  lockDownNavigation(win.webContents)
  trustWebContents(win.webContents, kind)
}
