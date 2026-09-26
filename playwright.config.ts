import { defineConfig } from '@playwright/test'

export default defineConfig({
  outputDir: 'tests/results',
  retries: process.env.CI ? 2 : 0,
  /**
   * 必须串行：被测应用是「单实例 + 固定端口 41830」的桌面应用。
   * 并行 worker 会让多个 Electron 实例同时抢 41830，而主进程在端口被占用时
   * 会 fail-closed 退出（见 src/main/index.ts），导致用例随机失败。
   */
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 10000
  }
})
