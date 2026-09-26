<template>
  <span>
    <router-link v-if="to" :to="to">{{ text }}</router-link>
    <template v-else>{{ text }}</template>
  </span>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * 封面/行卡片副标题的统一渲染点。
 *
 * 历史上的实现是把平台 UGC 字段（专辑名 / 艺人名 / 歌单简介 / 昵称）拼成 HTML
 * 字符串后交给 innerHTML 指令写入，导致存储型 HTML 注入（见 issue #416）。
 * 这里改为「数据 → 模板」：需要跳转时走 `<router-link>`，其余情况一律作为纯文本
 * 插值，由 Vue 自动转义。
 */
defineProps<{
  /** 展示文本，一律按纯文本渲染 */
  text: string
  /** 需要跳转时的路由目标；为假值则只渲染文本 */
  to?: RouteLocationRaw | null
}>()
</script>
