<template>
  <VueDraggable v-model="test" class="cover-row" :disabled="false" :style="rowStyles">
    <div v-for="item in items" :key="item?.id" class="item" :class="{ artist: type === 'Artist' }">
      <Cover
        :id="item.id"
        :plugin-id="item.pluginId!"
        :image-url="getImageUrl(item)"
        :type="type"
        :source-context="item.sourceContext"
        :play-button-size="type === 'Artist' ? 26 : playButtonSize"
      />
      <div class="text">
        <div v-show="showPlayCount" class="info">
          <span class="play-count">
            <svg-icon icon-class="play" />{{
              formatPlayCount('playCount' in item ? item.playCount : 0)
            }}
          </span>
        </div>
        <div class="title" :style="{ fontSize: subTextFontSize }">
          <span v-show="isExplicit(item)" class="explicit-symbol">
            <ExplicitSymbol />
          </span>
          <span v-show="isPrivacy(item)" class="lock-icon">
            <SvgIcon icon-class="lock" />
          </span>
          <router-link :to="`/${type}/${item.pluginId}/${JSON.stringify(item.sourceContext)}`">{{
            item.name
          }}</router-link>
        </div>
        <div v-show="type !== 'Artist' && subText !== 'none'" class="info">
          <SubTextContent v-bind="getSubText(item)" />
        </div>
      </div>
    </div>
  </VueDraggable>
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue'
import Cover from './CoverBox.vue'
import SvgIcon from './SvgIcon.vue'
import ExplicitSymbol from './ExplicitSymbol.vue'
import SubTextContent from './SubTextContent.vue'
import { VueDraggable } from 'vue-draggable-plus'
import { formatPlayCount } from '../utils'
import { Album, Artist, PlaylistDetail } from '@/types/plugin'
import { CoverType } from '@/types/music'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps({
  items: {
    type: Array as () => (Album | Artist | PlaylistDetail)[],
    required: true
  },
  showPlayCount: { type: Boolean, default: false },
  type: { type: String as PropType<CoverType>, required: true },
  subText: { type: String, default: 'null' },
  subTextFontSize: { type: String, default: '16px' },
  colunmNumber: { type: Number, default: 5 },
  gap: { type: String, default: '34px 24px' },
  playButtonSize: { type: Number, default: 22 }
})

// const localMusicStore = useLocalMusicStore()
// const { sortPlaylistsIDs } = storeToRefs(localMusicStore)
// const isLocal = computed(() => props.type.includes('local'))

// const list = computed({
//   get: () =>
//     // isLocal.value
//     //   ? sortPlaylistsIDs.value.map((id: number) => props.items.find((item) => item.id === id)!)
//        props.items,
//   set: (value) => {
//     sortPlaylistsIDs.value = value.map((item) => item.id) as number[]
//   }
// })

const test = ref([])

const rowStyles = computed(() => {
  return {
    'grid-template-columns': `repeat(${props.colunmNumber}, 1fr)`,
    gap: props.gap
  }
})

const getImageUrl = (item: any) => {
  return item.picUrl
}

const isExplicit = (item: any) => {
  return props.type === 'Album' && item.mark === 1056768
}

const isPrivacy = (item: any) => {
  return props.type === 'Playlist' && item.isPrivate
}

/**
 * 副标题解析结果。
 *
 * 注意：平台 UGC（专辑名 / 歌单简介等）一律通过 `text` 作为纯文本渲染，
 * 只有指向应用内路由时才产出 `to`，绝不再拼接 HTML 字符串。
 */
const getSubText = (item: any): { text: string; to?: RouteLocationRaw | null } => {
  const type = props.subText
  if (type === 'artist') {
    return {
      text: item.name ?? '',
      // 缺少插件信息时不产出路由目标，避免生成无法解析的链接
      to:
        item.pluginId && item.sourceContext
          ? {
              name: 'ArtistPage',
              params: {
                pluginId: item.pluginId,
                sourceContext: JSON.stringify(item.sourceContext)
              }
            }
          : null
    }
  }
  if (type === 'updateFrequency') {
    return { text: item.updateFrequency ?? '' }
  }
  if (type === 'copywriter') {
    return { text: item.copywriter ?? '' }
  }
  if (type === 'releaseYear') {
    const year = new Date(item.createTime).getFullYear()
    return { text: Number.isFinite(year) ? year.toString() : '' }
  }
  if (type === 'albumType+releaseYear') {
    let albumType = item.type
    if (item.type === 'EP') {
      albumType = 'EP'
    } else if (item.type === '单曲') {
      albumType = 'Single'
    } else if (item.type === '专辑') {
      albumType = 'Album'
    }
    const year = new Date(item.createTime).getFullYear()
    return { text: Number.isFinite(year) ? `${albumType} · ${year}` : `${albumType}` }
  }
  return { text: '' }
}
</script>

<style scoped lang="scss">
.cover-row {
  display: grid;
}

.item {
  color: var(--color-text);
  .text {
    margin-top: 8px;
    .title {
      font-size: 16px;
      font-weight: 600;
      line-height: 20px;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
      word-break: break-all;
    }
    .info {
      font-size: 12px;
      opacity: 0.68;
      line-height: 18px;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
      word-break: break-word;
    }
  }
}

.item.artist {
  display: flex;
  flex-direction: column;
  text-align: center;
  .cover {
    display: flex;
  }
  .title {
    margin-top: 4px;
  }
}

@media (max-width: 834px) {
  .item .text .title {
    font-size: 14px;
  }
}

.explicit-symbol {
  opacity: 0.28;
  color: var(--color-text);
  float: right;
  .svg-icon {
    margin-bottom: -3px;
  }
}

.lock-icon {
  opacity: 0.28;
  color: var(--color-text);
  margin-right: 4px;
  // float: right;
  .svg-icon {
    height: 12px;
    width: 12px;
  }
}

.play-count {
  font-weight: 600;
  opacity: 0.58;
  color: var(--color-text);
  font-size: 12px;
  .svg-icon {
    margin-right: 3px;
    height: 8px;
    width: 8px;
  }
}
</style>
