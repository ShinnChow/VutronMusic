import path from 'path'
import fs from 'fs'

/**
 * 路径安全工具（issue #416）。
 *
 * 渲染进程传入的任何路径都必须经过这里校验后才能触碰文件系统。
 * 原则：先规范化，再做**目录包含性**判断，最后尽量用 realpath 排除符号链接逃逸。
 */

/** Windows 保留设备名，不能作为文件名 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

/**
 * 把任意输入清洗成一个**不含任何目录成分**的安全文件名。
 * 用于渲染进程提供文件名（如自定义主题名）的场景。
 */
export function sanitizeFileName(input: unknown, fallback = 'unnamed'): string {
  const raw = typeof input === 'string' ? input : ''
  // path.basename 在 Windows 上同时处理 / 与 \；下面还会再兜底替换一次分隔符
  let name = path.basename(raw)
  // 控制字符（含 NUL）
  name = name.replace(/[\u0000-\u001f\u007f]/g, '')
  // 各平台分隔符与 Windows 非法字符
  name = name.replace(/[\\/:*?"<>|]/g, '_')
  // 去掉前导点，避免 '.' / '..' / 隐藏文件
  name = name.replace(/^[.\s]+/, '')
  // Windows 不允许文件名以点或空格结尾
  name = name.replace(/[.\s]+$/, '')
  if (!name) return fallback
  if (WINDOWS_RESERVED_NAMES.has(name.toUpperCase())) return `${name}_`
  return name.slice(0, 64)
}

/**
 * 判断 `target` 是否位于目录 `root` 之内（不含 root 自身）。
 * 纯字符串级判断，不做符号链接解析。
 */
export function isPathInside(target: string, root: string): boolean {
  if (!target || !root) return false
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget === resolvedRoot) return false
  const rel = path.relative(resolvedRoot, resolvedTarget)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * 在 `isPathInside` 基础上追加 realpath 校验，用于**写/删**等破坏性操作，
 * 防止目录内存在指向外部的符号链接。
 *
 * 目标不存在（例如删除一个已不存在的文件）时返回 false。
 */
export function isPathInsideResolved(target: string, root: string): boolean {
  if (!isPathInside(target, root)) return false
  try {
    const realRoot = fs.realpathSync(root)
    const realTarget = fs.realpathSync(target)
    return isPathInside(realTarget, realRoot)
  } catch {
    return false
  }
}

/** 判断路径是否为已存在的普通文件 */
export function isExistingFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

/** 判断路径是否为已存在的目录 */
export function isExistingDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}
