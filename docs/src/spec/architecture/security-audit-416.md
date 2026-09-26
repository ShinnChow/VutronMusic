---
last-updated: 2026-09-26
title: '安全审查：#416 修复复核'
order: 15
last-reviewed: 2026-09-26
---

# 安全审查：[issue #416](https://github.com/stark81/VutronMusic/issues/416) 修复复核

- **复核对象**：`main@74b8869` 之上针对 #416 的修复（含本轮补充修复）。
- **复核方式**：源码走查 + 把安全模块编译为 CJS 后用 24 条断言做行为验证 + Playwright E2E（12 用例全绿，见文末「验证资产」）。
- **相关文档**：[安全边界与不变量](./security)、[测试](./testing)。

## 一、结论

issue #416 报告的四条缺陷**全部已修复**，其串成的攻击链（存储型 HTML 注入 → 特权窗口导航 → preload 在攻击者 origin 重新执行 → 无校验的文件系统 IPC）**已完整切断**。

修复采用「多层独立防御」而非单点补丁：即使其中一层被绕过，后续层仍能阻断或把影响限制在授权范围内。审查中未发现可复现的绕过；本轮另外补掉了三处**同类残留** （插件 API 绕过授权、扫描/定位通道无参数校验、授权判定坐标系不一致）。

## 二、攻击链逐步复核

| # | issue 描述的攻击步骤 | 现状 | 关键实现 |
| --- | --- | --- | --- |
| 1 | 平台 UGC（艺人名/专辑名）未转义拼进锚点 HTML | ✅ 已消除 | UGC 一律纯文本渲染，`SubTextContent.vue` 取代字符串拼接 |
| 2 | DOMPurify 默认配置放行任意外链锚点，payload 经 `innerHTML` 落地 | ✅ 已消除 | `v-same-html` 指令整体删除；`v-safe-html` 采用严格白名单 + 链接降级 |
| 3 | 主窗口无导航限制，点击一次即整窗导航到攻击者站点 | ✅ 已阻断 | `windowHardening.ts`：`will-navigate` / `will-redirect` / `setWindowOpenHandler` / `will-attach-webview` |
| 4 | preload 在攻击者 origin 重新执行，白名单只校验 channel 名 | ✅ 已阻断 | `ipcGuard.ts`：登记窗口 + 主 frame + origin 三重校验，fail-closed |
| 5a | `delete-screenshot` 任意路径删除 | ✅ 已阻断 | `screenshotStore.ts`：限定 `userData/screenshots` 内、`screenshot_*.png`、realpath 校验 |
| 5b | `get-screenshot` 路径遍历写入 | ✅ 已阻断 | `sanitizeFileName()` + 目录包含性双保险 |
| 5c | `getFilesInFolder` 任意目录枚举 | ✅ 已阻断 | 授权目录白名单（原生对话框是唯一授权来源） |
| 5d | `msgCheckFileExist` 任意文件存在性 oracle | ✅ 已阻断 | 同上，未授权时返回 `authorized: false` |

> 注意第 1、2 步的修复是**根因修复**：即使响应被篡改（企业代理、被入侵 DNS、本机进程），或平台侧再次下发恶意 UGC，渲染层也不会再把它当 HTML 执行。

## 三、四条缺陷的核对依据

### 1. 存储型 HTML 注入（CWE-79）

- 四个注入点 `CoverRow.vue` / `VirtualCoverRow.vue` / `MvRow.vue` / `LatestVersion.vue` 全部改造：前三者返回 `{ text, to }` 数据结构，交由 `SubTextContent.vue` 渲染（`{{ text }}` 自动转义；需要跳转时走 `<router-link>`），后者改用 `v-safe-html`。
- 全仓 `v-same-html` 指令与用法**零残留**；`innerHTML` 仅存在于 `v-safe-html` 一处；无 `v-html`、无其它 UGC 驱动的 `:href`/`innerHTML` sink。
- `v-safe-html` 配置为严格标签白名单 + `ALLOWED_URI_REGEXP: /^https:\/\//i` + `afterSanitizeAttributes` 挂钩强制外链 `target="_blank"` 与 `rel="noopener noreferrer nofollow"`，使链接必须经 `setWindowOpenHandler` 走系统浏览器。

### 2. 任意文件删除 / 任意路径写入（CWE-22）

`screenshotStore.ts` 把「文件名清洗」与「目录包含性判断」分离实现，并叠加 realpath 校验：

- `saveScreenshot()`：`sanitizeFileName()` 剥离目录成分、控制字符、Windows 保留设备名，再校验落盘路径必须位于 `screenshots` 目录内；
- `deleteScreenshot()`：目标必须位于 `screenshots` 内、文件名匹配 `screenshot_*.png`、且 realpath 后仍在该目录内（挡住目录内的符号链接）。

行为验证（编译真实模块执行，issue 原文 PoC 直接复用）：

| 输入 | 结果 |
| --- | --- |
| `get-screenshot('x\..\..\..\..\evil-written')` | 落盘于 `screenshots/screenshot_x_.._.._.._.._evil-written_<ts>_<hex>.png`，遍历目标未创建 |
| `deleteScreenshot('<任意绝对路径>')` | 拒绝，受害文件存活 |
| `screenshots/screenshot_link.png`（符号链接指向外部） | 拒绝，受害文件存活 |
| 正常保存 → 删除 往返 | 正常（无功能回归） |

### 3. 任意目录枚举 / 存在性探测（CWE-200）

授权模型收敛到 `pathGrants.ts`：

- 授权来源**只有**原生对话框（`selecteFolder` / `showOpenDialog` / `msgOpenFile`）；
- 授权结果持久化在 electron-store 的 `security.grantedPaths` / `security.grantedFiles`， **不是** `settings.*`，因此渲染层无法写入；
- 判定时两边都做 realpath 归一化，并拒绝 `..` 逃逸与符号链接逃逸；
- `getFilesInFolder` 未授权时抛 `FOLDER_NOT_AUTHORIZED`，`msgCheckFileExist` 返回 `authorized: false`，渲染层据此提示用户重新选择目录（`toast.reauthRequired`）。

行为验证：未授权目录、`..` 逃逸、授权目录内指向外部的符号链接、`/etc/hosts` 全部拒绝；授权目录内文件放行；应用自有目录（`screenshots` / `audioCache`）无需授权。

### 4. IPC 调用方未校验（CWE-862）

`ipcGuard.ts` 在 `ipcMain.on/handle` 上包一层守卫，`installIpcGuard()` 在任何 IPC 通道注册、任何窗口创建**之前**安装（`src/main/index.ts` 的 `whenReady` 回调首行），因此 `IPCs.ts` / `menu.ts` / `dock.ts` / `thumBar.ts` 的全部注册点自动覆盖。

每次调用校验：**已登记窗口** → **主 frame** → **frame URL origin === `Constants.APP_ORIGIN`**，任一不满足即拒绝并记录 `[security]` 日志。窗口侧由 `windowHardening.ts` 的 `hardenWindow(win, kind)` 统一施加导航锁并登记，未登记的窗口拿不到任何 IPC（fail-closed）。

审查确认的关键点：

- 全仓只有两处 `new BrowserWindow`（主窗口、桌面歌词窗口），且都在 `loadURL()` 之前调用了 `hardenWindow()`；不存在「忘记加固却仍有特权」的窗口；
- 入口到通道的分级（`MAIN_ONLY_CHANNELS` / `OSD_ONLY_CHANNELS`）与实际调用方一致，没有误伤（E2E「守卫不误伤正常调用」用例覆盖）；
- 采用 `ipcMain` 包装而非逐个 handler 改造，新增通道默认继承校验，不存在遗漏面。

### 5. 额外加固（同批变更）

| 项 | 处理 |
| --- | --- |
| `msgOpenExternalLink` | 只允许 `http:` / `https:` / `mailto:`，挡掉 `javascript:` / `file:` / 系统协议处理器 |
| `vutron://` 协议 | 带跨源 `Origin` 的请求返回 403；本地文件读取须落在授权范围或应用自有目录 |
| `setStoreSettings` | 运行时 key 白名单，并消除 dot-path 覆盖嵌套设置与 `__proto__` 风险 |
| 本地 HTTP 服务 | 显式 `host: '127.0.0.1'`；主服务端口被占用时 fail-closed 退出 |
| 响应头 | 安全子集 CSP（`object-src` / `base-uri` / `frame-ancestors`）+ `nosniff` |

## 四、本轮补充修复

首轮审查发现三处**同类残留**，均不重开 #416 的链（攻击者页面已拿不到 `window.mainApi`），但违反「渲染进程传来的路径必须先授权再使用」这条不变量，已一并修掉。

### R1 — 插件 API 绕过 `pathGrants`（`src/main/utils/pluginManager.ts`）

`plugin-method-call` 把参数原样交给插件，而 `apis.utils.checkFileExist` / `getPathLyric` / `getEmbeddedLyric` 在主进程侧直接 `fs.access` / `fs.readFile`， **完全不经过授权判定** —— 等于在 `msgCheckFileExist` 之外留了同一个存在性 oracle（`local.js` 的 `doLogin({ dirs })` 就走这条路）。

修复：`CHECK_FILE_EXIST` / `LYRIC_PATH` / `LYRIC_EMBEDDED` 三个分支分别接入 `isGrantedPath()` / `isGrantedLocalResource()`，未授权时分别返回 `{ exist: false, authorized: false }` 与空歌词，并记录 `[security]` 日志。插件运行在主进程 Node 权限下，这条边界必须与 IPC 层用同一套判定。

### R2 — 扫描 / 定位通道无参数校验（`src/main/IPCs.ts`）

- `msgScanLocalMusic`：会对渲染层传入的任意目录做**递归扫描**（绕过 `getFilesInFolder` 的授权检查）。现在先过滤出已授权目录，未授权的一律丢弃并记日志；全部未授权时直接返回（且不在校验前置 `isScanningLocalMusic` 标志，避免提前返回把标志卡住）。
- `msgShowInFolder`：`shell.showItemInFolder` 现在要求路径落在授权范围内。

### R3 — 授权判定的坐标系不一致（`src/main/utils/pathGrants.ts`）

授权根以 realpath 存储，而**不存在的目标**此前走 `path.resolve`（不解析符号链接）。当路径含符号链接分量时（macOS `/var` → `/private/var`、`/tmp`、自定义 `--user-data-dir`、被符号链接的 HOME），授权目录内**尚不存在**的文件会被误判为未授权。

这是**假阴性（fail-closed）**，不是安全漏洞，但会造成两个实际后果：`msgCheckFileExist` 对「已授权但已删除」的扫描目录返回 `authorized: false`，从而弹出多余的重新选择提示；以及 `--user-data-dir` 位于临时目录时应用自有目录判定异常。

修复：`canonicalize()` 改为对「第一个存在的祖先」取 realpath 再把剩余分量接回去。路径存在时行为与原先完全一致；不含符号链接时与 `path.resolve` 等价。

修复前后对比（实测，macOS `os.tmpdir()`）：

| 场景                                  | 修复前        | 修复后            |
| ------------------------------------- | ------------- | ----------------- |
| 授权目录内已存在的文件                | ✅ 授权       | ✅ 授权           |
| 授权目录内**不存在**的文件            | ❌ 误判未授权 | ✅ 授权           |
| 应用自有目录内**不存在**的文件        | ❌ 误判未授权 | ✅ 授权           |
| 未授权目录 / `..` 逃逸 / 符号链接逃逸 | ✅ 拒绝       | ✅ 拒绝（未削弱） |

## 五、残留与已接受的风险

以下项**不在本轮修复范围**，需要产品决策或后续单独评估（`security.md` 的「已知遗留」为权威列表）：

| 项 | 说明 |
| --- | --- |
| Amuse 服务（9863）CORS | 仍是 `origin: '*'`：Amuse 客户端通常是 OBS 浏览器源（强制 CORS），合法 origin 无法枚举。代价是任意网站可读到当前播放的曲目信息 |
| Amuse 监听地址 | 已收敛为 `127.0.0.1`：跨机使用 OBS 的用户会失效，属有意的安全取舍 |
| `setPermissionRequestHandler` | 未设置。收紧前需先验证 `SystemSettings.vue` 的输出设备列表（依赖 `device.label`） |
| `/local-asset/player`、`/netease/*` 代理 | 无鉴权 / 无 CSRF 保护的本机接口，未启用 CORS，本机同用户进程本来即可访问 |
| `vutron://get-color`、`get-online-music` | 属网络请求（SSRF 面）而非本地文件读取，未在本轮限制 |
| `blob:` URL 的 origin | `new URL('blob:http://localhost:41830/...').origin` 等于 `APP_ORIGIN`，因此 `ipcGuard` 会把它视为可信。要走到这一步需要攻击者已能在应用 origin 执行脚本（正是缺陷 1 修掉的前提），当前不构成路径；若要更严可要求 frame URL 协议为 `http:` 且落在已知入口内 |
| dev 模式的 fail-closed 覆盖面 | dev 时 Fastify 绑 40001、页面由 Vite(41830) 提供，因此「41830 被他人占用」在 dev 不会被那个 try/catch 捕获（生产环境才是被保护的情形） |

### 升级影响（有意为之，需要 release note 告知用户）

授权不做自动迁移（避免把历史遗留的恶意路径一并授权），因此升级后：

- 自定义背景 / 视频 / lottie 配置需要重新选择（`BackgroundPage.vue` 会清空失效项并提示）；
- 本地音乐扫描目录需要重新选择（`pluginMusic.ts` 会提示）；
- 在用户重新选择之前，本地歌曲封面（`vutron://get-pic-path`）会回落到默认封面。

## 六、验证资产

### 单元级行为验证

把 `pathSafety.ts` / `screenshotStore.ts` / `pathGrants.ts` 用 esbuild 编译为 CJS（stub 掉 `electron` / `store` / `log`）后执行 24 条断言，覆盖：文件名清洗、目录包含性、 `..` 逃逸、符号链接逃逸、任意路径删除、遍历写入、授权目录增删、应用自有目录、坐标系一致性。**24/24 通过**。

### E2E（`tests/security.spec.ts`）

```bash
lsof -nP -iTCP:41830 -sTCP:LISTEN   # 前置条件：应无输出（先关掉 yarn dev / 应用）
npx playwright test                 # workers=1 串行
```

最近一次运行：**12 passed**（含 `tests/app.spec.ts`），涵盖导航锁、`window.open` 拒绝、未授权路径拒绝、设置白名单、`get-screenshot` 遍历写入、`delete-screenshot` 任意删除与正常删除、授权判定一致性、`msgScanLocalMusic` 未授权目录、插件侧存在性探测。

> E2E 对 `ipcGuard` 的运行时生效性提供了直接证据：正常 IPC 可用 + 越权路径被拒 + 跨源导航被拦，三者同时成立。

## 七、后续修改的检查清单

1. 新增窗口 → 是否调用 `hardenWindow()`？需要哪些通道分级？
2. 新增 IPC 通道 → 是否需要加入 `preload` 白名单？入参是否按不可信处理？
3. **新增任何触碰文件系统的路径（IPC / 插件 API / 协议处理器）→ 是否经过 `pathGrants` / `pathSafety`？**
4. 新增设置项 → 是否加入 `settingKeys.ts` 白名单？渲染层写入的 key 是否一致？
5. 渲染 UGC → 是否只用了 `{{ }}` 或 `SubTextContent`？有没有新的 `innerHTML` sink？
6. 改动安全模块 → 是否同步更新 `tests/security.spec.ts` 并跑通？
