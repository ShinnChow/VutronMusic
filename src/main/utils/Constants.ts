import { join, dirname } from 'path'
import { name, version } from '../../../package.json'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default class Constants {
  // Display app name (uppercase first letter)
  static APP_NAME = name.charAt(0).toUpperCase() + name.slice(1)

  static APP_VERSION = version

  static IS_DEV_ENV = process.env.NODE_ENV === 'development'

  static IS_MAC = process.platform === 'darwin'

  static IS_WINDOWS = process.platform === 'win32'

  static IS_LINUX = process.platform === 'linux'

  static DEFAULT_WEB_PREFERENCES = {
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    preload: join(__dirname, '../preload/index.js')
  }

  static DEFAULT_OSD_PREFERENCES = {
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    preload: join(__dirname, '../preload/osdWin.js')
  }

  static ELECTRON_WEB_SERVER_PORT = 41830
  static ELECTRON_DEV_NETEASE_API_PORT = 40001

  /**
   * 渲染进程所在的可信 origin（主窗口与桌面歌词窗口同源）。
   *
   * - dev：Vite 开发服务器（vite.config.ts 中 port=41830 且 strictPort=true）
   * - prod：内嵌 Fastify 静态服务（ELECTRON_WEB_SERVER_PORT）
   *
   * 该值是安全边界的一部分：窗口导航锁与 IPC 调用方校验都以它为准，
   * 修改端口时必须同步修改这里。
   */
  static APP_ORIGIN = `http://localhost:${Constants.ELECTRON_WEB_SERVER_PORT}`

  static APP_INDEX_URL_DEV = `${Constants.APP_ORIGIN}/index.html`
  static APP_INDEX_URL_PROD = `${Constants.APP_ORIGIN}/#/index.html`
  // static APP_OSD_URL_PROD = join(__dirname, '../../osdlyric.html')
  static APP_OSD_URL = `${Constants.APP_ORIGIN}/osdlyric.html`
  // static APP_OSD_URL_PROD = join(__dirname, '../index.html')

  /**
   * 本地服务响应的 CSP（纵深防御）。
   *
   * 这里刻意只包含**不会误伤现有功能**的指令：
   *   - `object-src 'none'`     禁止 <object>/<embed>
   *   - `base-uri 'none'`       禁止注入 <base> 改写相对路径
   *   - `frame-ancestors 'none'` 禁止被任何页面嵌入
   *
   * 尚未启用 `script-src` / `img-src` / `connect-src`：本应用是多源在线音乐播放器，
   * 需要访问任意 https 源、blob:/data: 资源以及 vutron:// 自定义协议，且渲染层
   * 依赖若干第三方库，收紧这些指令必须先逐页面人工验证。
   * 详见 docs/src/spec/architecture/security.md。
   */
  static LOCAL_SERVER_CSP = "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
}
