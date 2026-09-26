import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import store from '../store'
import log from '../log'
import { isExistingDirectory, isExistingFile, isPathInside } from './pathSafety'

/**
 * 目录访问授权（issue #416）。
 *
 * 背景：`getFilesInFolder` 可以枚举任意目录，`msgCheckFileExist` 可以探测任意
 * 文件是否存在 —— 两者都直接把渲染进程传来的路径交给文件系统。
 *
 * 合法的用途只有两处（随机背景文件夹、本地音乐扫描目录），且这两处的路径
 * 都来自用户通过系统对话框主动选择的目录。因此这里维护一份「用户显式授权过的
 * 目录」白名单：
 *
 *   - 只有 `selecteFolder` / `showOpenDialog(openDirectory)` 的返回值会被登记；
 *   - 白名单持久化在 store 的 `security.grantedPaths`（渲染进程写不到）；
 *   - 校验时对目标做 realpath 归一化，再判断是否等于某个授权目录或位于其下。
 *
 * 由于授权只发生在原生对话框返回之后，升级到本版本后用户需要重新选择一次
 * 文件夹（产品决策：不做自动迁移，避免把历史遗留的恶意路径一并授权）。
 */

const GRANTED_PATHS_KEY = 'security.grantedPaths'

export function getGrantedPaths(): string[] {
  const raw = store.get(GRANTED_PATHS_KEY) as unknown
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && !!item)
}

function setGrantedPaths(paths: string[]): void {
  store.set(GRANTED_PATHS_KEY, paths)
}

/**
 * 把用户选中的目录登记为已授权。
 * 只接受真实存在的目录；返回规范化后的绝对路径，失败返回 null。
 */
export function grantPath(input: unknown): string | null {
  if (typeof input !== 'string' || !input) return null

  let canonical: string
  try {
    canonical = fs.realpathSync(path.resolve(input))
  } catch {
    return null
  }
  if (!isExistingDirectory(canonical)) return null

  const granted = getGrantedPaths()
  if (!granted.includes(canonical)) {
    setGrantedPaths([...granted, canonical])
    log.info(`[security] 已授权目录访问: ${canonical}`)
  }
  return canonical
}

export function grantPaths(inputs: unknown): string[] {
  if (!Array.isArray(inputs)) return []
  return inputs.map((item) => grantPath(item)).filter((item): item is string => !!item)
}

/**
 * 判断路径是否已被用户显式授权：等于某个授权目录，或位于其下。
 */
export function isGrantedPath(input: unknown): boolean {
  if (typeof input !== 'string' || !input) return false

  const resolved = canonicalize(input)
  return getGrantedPaths().some((root) => resolved === root || isPathInside(resolved, root))
}

/* -------------------------------------------------------------------------- */
/* 单文件授权（vutron:// 本地资源读取）                                        */
/* -------------------------------------------------------------------------- */

const GRANTED_FILES_KEY = 'security.grantedFiles'

export function getGrantedFiles(): string[] {
  const raw = store.get(GRANTED_FILES_KEY) as unknown
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && !!item)
}

function setGrantedFiles(files: string[]): void {
  store.set(GRANTED_FILES_KEY, files)
}

/**
 * 把用户在「选择文件」对话框中选中的文件登记为已授权。
 * 只接受真实存在的普通文件。
 */
export function grantFile(input: unknown): string | null {
  if (typeof input !== 'string' || !input) return null

  let canonical: string
  try {
    canonical = fs.realpathSync(path.resolve(input))
  } catch {
    return null
  }
  if (!isExistingFile(canonical)) return null

  const granted = getGrantedFiles()
  if (!granted.includes(canonical)) {
    setGrantedFiles([...granted, canonical])
    log.info(`[security] 已授权文件访问: ${canonical}`)
  }
  return canonical
}

export function grantFiles(inputs: unknown): string[] {
  if (!Array.isArray(inputs)) return []
  return inputs.map((item) => grantFile(item)).filter((item): item is string => !!item)
}

export function isGrantedFile(input: unknown): boolean {
  if (typeof input !== 'string' || !input) return false
  return getGrantedFiles().includes(canonicalize(input))
}

/** 应用自身管理的目录：这些目录下的资源无需用户授权即可读取 */
function getAppOwnedReadRoots(): string[] {
  const userData = app.getPath('userData')
  return [path.join(userData, 'screenshots'), path.join(userData, 'audioCache')]
}

function isInsideAppOwnedRoot(input: string): boolean {
  const resolved = canonicalize(input)
  // 根目录同样必须realpath 归一化：userData 路径本身可能经过符号链接
  // （例如 macOS 的 /tmp → /private/tmp），否则合法资源会被误判为越界。
  return getAppOwnedReadRoots().some((root) => isPathInside(resolved, canonicalize(root)))
}

/**
 * `vutron://local-resource` 与 `vutron://local-asset?type=stream|json` 的读取校验。
 *
 * 允许三类路径：
 *   1. 用户授权目录内的文件（自定义背景文件夹、本地音乐目录、自定义缓存目录）；
 *   2. 用户在「选择文件」对话框中选中的单个文件；
 *   3. 应用自身目录（screenshots / audioCache）。
 */
export function isGrantedLocalResource(input: unknown): boolean {
  if (typeof input !== 'string' || !input) return false
  return isGrantedPath(input) || isGrantedFile(input) || isInsideAppOwnedRoot(input)
}

/**
 * 把输入归一化到与授权根**同一坐标系**的绝对路径。
 *
 * 授权根在 `grantPath` / `grantFile` 时已做 realpath（解析符号链接），因此这里
 * 也必须解析符号链接。否则当路径中含符号链接分量时（macOS `/var` → `/private/var`、
 * `/tmp`、自定义 `--user-data-dir`、被符号链接的 HOME 等），两边坐标系不一致，
 * 授权目录内**尚不存在**的文件会被误判为未授权（issue #416 审查发现的假阴性）。
 *
 * 目标不存在时无法直接 realpath，因此改为对「第一个存在的祖先」取 realpath，
 * 再把剩余分量原样接回去；路径中不含符号链接时结果与 `path.resolve` 等价。
 */
function canonicalize(input: string): string {
  const resolved = path.resolve(input)
  let current = resolved
  const missing: string[] = []

  for (;;) {
    try {
      const real = fs.realpathSync(current)
      return missing.length ? path.join(real, ...missing.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      // 已到根目录仍失败：退化为绝对路径（fail-closed，由调用方的包含性判断兜底）
      if (parent === current) return resolved
      missing.push(path.basename(current))
      current = parent
    }
  }
}
