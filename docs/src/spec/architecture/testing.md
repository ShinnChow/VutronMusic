---
last-updated: 2026-09-26
title: 测试
order: 5
last-reviewed: 2026-09-26
---

# 测试

## 测试框架

项目使用 **Playwright** 进行 E2E 测试，支持 Electron 应用的自动化测试。当前未配置单元测试框架（无 vitest/jest）。

| 工具       | 用途                                | 配置文件               |
| ---------- | ----------------------------------- | ---------------------- |
| Playwright | E2E 测试（Electron 启动、窗口交互） | `playwright.config.ts` |

## 配置

`playwright.config.ts` 关键配置：

| 配置项           | 值              | 说明                                    |
| ---------------- | --------------- | --------------------------------------- |
| `outputDir`      | `tests/results` | 测试结果输出目录                        |
| `retries`        | CI: 2, 本地: 0  | 失败重试次数                            |
| `workers`        | 1               | 必须串行，见下方「为什么必须单 worker」 |
| `timeout`        | 60000ms         | 单个测试超时                            |
| `expect.timeout` | 10000ms         | 断言超时                                |

### 为什么必须单 worker

被测应用是**单实例 + 固定端口 41830** 的桌面应用：

- 主进程在端口被占用时会 fail-closed 直接退出（`src/main/index.ts`，防止窗口加载到同 origin 的他人内容）；
- `app.requestSingleInstanceLock()` 的锁按 userData 目录隔离，因此每个 spec 都必须用独立的 `--user-data-dir`。

多个 Electron 实例并行运行会互相抢 41830，表现为用例随机超时。因此 `workers` 固定为 1。

### 启动参数（每个 spec 都必须带）

```typescript
args: ['dist/main/index.js', '--no-sandbox', `--user-data-dir=${userDataDir}`]
```

- `--no-sandbox`：受限环境（CI / 容器）下 Chromium sandbox 初始化失败会导致应用立即退出， `electron.launch()` 会一直等到 `beforeAll` 超时；
- `--user-data-dir`：使用 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` 创建的临时目录，避免污染真实用户数据。

## 现有测试

### `tests/app.spec.ts` — 应用启动检测

验证 Electron 应用能正常启动且处于开发模式（`isPackaged = false`）。

### `tests/security.spec.ts` — 安全回归（issue #416）

覆盖安全边界。**改动 `src/main/utils/ipcGuard.ts`、`windowHardening.ts`、`pathGrants.ts`、 `pathSafety.ts`、`screenshotStore.ts`、`settingKeys.ts`、`src/main/IPCs.ts` 或 `src/preload/*` 时必须跑它。** 用例清单：

| 用例                                                | 保护的边界                        |
| --------------------------------------------------- | --------------------------------- |
| 应用自身窗口的 IPC 调用仍然可用                     | 守卫不误伤正常调用                |
| 特权窗口不能被导航到应用 origin 之外                | `will-navigate` 导航锁            |
| `window.open` / `target=_blank` 被拒绝              | `setWindowOpenHandler`            |
| 未授权的路径读取被拒绝                              | `pathGrants` 授权目录白名单       |
| `setStoreSettings` 忽略白名单之外的键               | `settingKeys` 运行时白名单        |
| `get-screenshot` 清洗文件名，无法路径遍历写出       | CWE-22 任意路径写入               |
| `delete-screenshot` 不能删除 screenshots 之外的文件 | CWE-22 任意文件删除               |
| `delete-screenshot` 仍能删除本应用生成的主题截图    | 上述限制不误伤正常功能            |
| 授权判定对「尚不存在的目标」保持一致                | `canonicalize()` 坐标系一致性     |
| `msgScanLocalMusic` 忽略未授权目录                  | CWE-200 任意目录枚举              |
| 插件侧的存在性探测同样受授权限制                    | `plugin-method-call` 不得绕过授权 |

完整的攻击链复核与残留风险见 [安全审查：#416 修复复核](./security-audit-416)。

## 运行测试

| 命令              | 说明                                                          |
| ----------------- | ------------------------------------------------------------- |
| `yarn test`       | 先执行 `build:pre`（类型检查 + Vite 构建），再运行 Playwright |
| `yarn test:linux` | Linux 下通过 `xvfb-run` 运行（需要虚拟帧缓冲）                |

**前置条件**：运行 E2E 前必须关闭正在运行的 VutronMusic / `yarn dev`，否则 41830 被占用，主进程会 fail-closed 退出，测试会在 `beforeAll` 超时。

```bash
lsof -nP -iTCP:41830 -sTCP:LISTEN   # 应无输出
npx playwright test tests/security.spec.ts
```

**注意**：测试依赖构建产物（`dist/main/index.js`），不是直接测试源码。

## 编写新测试

1. 在 `tests/` 目录下创建 `*.spec.ts` 文件
2. 使用 `electron.launch()` 启动应用（参数见上方「启动参数」）：

```typescript
import { _electron as electron } from 'playwright'

let appWindow: Page
let appElectron: ElectronApplication

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vutron-app-test-'))

test.beforeAll(async () => {
  appElectron = await electron.launch({
    args: ['dist/main/index.js', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    locale: 'en-US',
    colorScheme: 'light',
    env: { ...process.env, NODE_ENV: 'production' }
  })
  appWindow = await appElectron.firstWindow()
  await appWindow.waitForEvent('load')
})

test.afterAll(async () => {
  await appElectron?.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
})
```

3. 使用 Playwright API 操作窗口元素（与 Web E2E 测试一致）
4. 需要应用真实 userData 目录时，用 `get-cache-path` 反推，不要假设 `--user-data-dir` 一定被按原样解析：

```typescript
const cachePath = await appWindow.evaluate(() => window.mainApi?.invoke('get-cache-path'))
const userData = path.dirname(String(cachePath))
```

## 平台注意事项

| 平台            | 说明                                                 |
| --------------- | ---------------------------------------------------- |
| Windows / macOS | 直接运行 `yarn test`                                 |
| Linux           | 需要 `xvfb`（虚拟帧缓冲），CI 中通过 `xvfb-run` 包装 |
| CI              | 自动重试 2 次                                        |

所有平台都按单 worker 串行执行（原因见上）。
