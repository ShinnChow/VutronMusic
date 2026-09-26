import { Page, _electron as electron } from 'playwright'
import { ElectronApplication } from 'playwright-core'
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

let appWindow: Page
let appElectron: ElectronApplication

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vutron-app-test-'))

test.beforeAll(async () => {
  // Open Electron app from build directory
  // --no-sandbox：受限环境下 Chromium sandbox 初始化失败会导致应用立即退出（与 security.spec.ts 同因）。
  // --user-data-dir：使用独立数据目录，避免污染真实用户数据。
  appElectron = await electron.launch({
    args: ['dist/main/index.js', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    locale: 'en-US',
    colorScheme: 'light',
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
  appWindow = await appElectron.firstWindow()

  await appWindow.waitForEvent('load')
})

test('Environment check', async () => {
  const isPackaged = await appElectron.evaluate(async ({ app }) => {
    return app.isPackaged
  })

  expect(isPackaged, 'Confirm that is in development mode').toBe(false)
})

test.afterAll(async () => {
  await appWindow?.waitForTimeout(2000).catch(() => {})
  await appElectron?.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
})
