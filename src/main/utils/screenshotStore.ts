import path from 'path'
import fs from 'fs'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import log from '../log'
import { isPathInside, isPathInsideResolved, sanitizeFileName } from './pathSafety'

/**
 * 自定义主题截图的读写边界（issue #416）。
 *
 * 之前 `get-screenshot` 把渲染进程传来的主题名直接拼进文件名
 * （`screenshot_${name}.png`），`../` 可以逃逸出 screenshots 目录写入任意路径；
 * `delete-screenshot` 更是把参数当作完整路径直接 `unlinkSync`，可删除任意文件。
 *
 * 现在两个操作都被限制在 `userData/screenshots/` 内的 `.png` 文件上。
 */

/** 本应用生成的截图文件名前缀（历史版本同名前缀，无需迁移） */
export const SCREENSHOT_FILE_PREFIX = 'screenshot_'

/** 本应用生成的截图文件名格式 */
const SCREENSHOT_FILE_PATTERN = /^screenshot_.+\.png$/i

export function getScreenshotsDir(): string {
  return path.join(app.getPath('userData'), 'screenshots')
}

function ensureScreenshotsDir(): string {
  const dir = getScreenshotsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 保存一张自定义主题截图。
 *
 * @param label 渲染进程提供的主题名，仅作为可读标签，经过完整清洗
 * @param buffer PNG 数据
 * @returns 落盘后的绝对路径；失败返回空字符串
 */
export function saveScreenshot(label: unknown, buffer: Buffer): string {
  const dir = ensureScreenshotsDir()
  const safeLabel = sanitizeFileName(label, 'theme')
  // 时间戳 + 随机后缀，避免同名主题在同一毫秒内互相覆盖
  const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`
  const fileName = `${SCREENSHOT_FILE_PREFIX}${safeLabel}_${suffix}.png`
  const filePath = path.join(dir, fileName)

  // 双保险：即使清洗逻辑被绕过，也绝不允许写到 screenshots 目录之外
  if (!isPathInside(filePath, dir)) {
    log.warn(`[security] 已拒绝越界的截图写入路径: ${filePath}`)
    return ''
  }

  try {
    fs.writeFileSync(filePath, buffer)
    return filePath
  } catch (err) {
    log.error('保存截图失败:', err)
    return ''
  }
}

/**
 * 删除一张自定义主题截图。
 *
 * 只接受位于 `userData/screenshots/` 内、文件名形如 `screenshot_*.png`
 * 的普通文件（realpath 校验，防止目录内的符号链接指向外部）。
 *
 * @returns 是否真的删除了文件
 */
export function deleteScreenshot(target: unknown): boolean {
  if (typeof target !== 'string' || !target) return false

  const dir = getScreenshotsDir()
  const resolved = path.resolve(target)

  if (!isPathInside(resolved, dir)) {
    log.warn(`[security] 已拒绝删除 screenshots 目录之外的文件: ${resolved}`)
    return false
  }
  if (!SCREENSHOT_FILE_PATTERN.test(path.basename(resolved))) {
    log.warn(`[security] 已拒绝删除非自定义主题截图文件: ${resolved}`)
    return false
  }
  if (!isPathInsideResolved(resolved, dir)) {
    // 文件不存在，或 realpath 后逃出了 screenshots 目录（符号链接）
    log.warn(`[security] 已拒绝删除越界或非普通文件的路径: ${resolved}`)
    return false
  }

  try {
    fs.unlinkSync(resolved)
    return true
  } catch (err) {
    log.error('删除截图失败:', err)
    return false
  }
}
