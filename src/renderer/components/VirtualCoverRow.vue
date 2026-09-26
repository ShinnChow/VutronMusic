<template>
  <VirtualScroll
    :list="items"
    :column-number="colunmNumber"
    :gap="gap"
    :item-size="itemHeight"
    :padding-bottom="paddingBottom"
    :height="containerHeight"
    :load-more="loadMore"
    :is-end="isEnd"
    :enable-virtual-scroll="enableVirtualScroll"
    :show-footer="showFooter"
    :show-position="showPosition"
  >
    <template #default="{ item }">
      <div class="cover-item" :class="{ artist: type === 'Artist' }">
        <Cover
          :id="item.id"
          :plugin-id="item.pluginId!"
          :source-context="item.sourceContext"
          :image-url="item.picUrl"
          :type="type"
          :play-button-size="type === 'Artist' ? 26 : playButtonSize"
        />
        <div class="text">
          <div v-if="isPlaylist(item)" v-show="showPlayCount" class="info">
            <span class="play-count">
              <svg-icon icon-class="play" />{{ formatPlayCount(item.playCount) }}
            </span>
          </div>
          <div class="title" :style="{ fontSize: subTextFontSize }">
            {{ `[${getPluginName(item.pluginId)}]: ` }}
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
    </template>
  </VirtualScroll>
</template>

<script setup lang="ts">
import { PropType, toRefs } from 'vue'
import VirtualScroll from './VirtualScrollNoHeight.vue'
import Cover from './CoverBox.vue'
import SvgIcon from './SvgIcon.vue'
import ExplicitSymbol from './ExplicitSymbol.vue'
import SubTextContent from './SubTextContent.vue'
import { usePluginMusic } from '../store/pluginMusic'
import { formatPlayCount } from '../utils'
import { Album, Artist, Playlist, PlaylistDetail } from '@/types/plugin'
import { CoverType } from '@/types/music'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps({
  items: { type: Array as () => (Playlist | Artist | Album | PlaylistDetail)[], required: true },
  type: { type: String as PropType<CoverType>, default: '' },
  subText: { type: String, default: null },
  itemHeight: { type: Number, default: 240 },
  showPosition: { type: Boolean, default: true },
  subTextFontSize: { type: String, default: '16px' },
  showPlayCount: { type: Boolean, default: false },
  containerHeight: { type: Number, default: 0 },
  colunmNumber: { type: Number, default: 1 },
  gap: { type: Number, default: 20 },
  playButtonSize: { type: Number, default: 22 },
  paddingBottom: { type: Number, default: 64 },
  isEnd: { type: Boolean, required: true },
  showFooter: { type: Boolean, default: false },
  enableVirtualScroll: { type: Boolean, default: true },
  loadMore: { type: Function as PropType<() => void>, default: () => {} }
})

const { items } = toRefs(props)

const isPlaylist = (item: Playlist | Artist | Album | PlaylistDetail): item is Playlist => {
  return 'playCount' in item
}

const { getPluginName } = usePluginMusic()

const isExplicit = (item: any) => {
  return props.type === 'Album' && item.mark === 1056768
}

const isPrivacy = (item: any) => {
  return props.type === 'Playlist' && item.isPrivate
}
/**
 * 副标题解析结果：UGC 字段一律经 `text` 纯文本渲染，只有应用内跳转才产出 `to`。
 * 不再拼接 HTML 字符串（见 issue #416）。
 */
const getSubText = (item: any): { text: string; to?: RouteLocationRaw | null } => {
  const type = props.subText
  if (type === 'artist') {
    const ar = item.artists?.[0] || null
    if (!ar) return { text: '' }
    return {
      text: ar.name ?? '',
      // 缺少插件信息时不产出路由目标，避免生成无法解析的链接
      to:
        ar.pluginId && ar.sourceContext
          ? {
              name: 'ArtistPage',
              params: {
                pluginId: ar.pluginId,
                sourceContext: JSON.stringify(ar.sourceContext)
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
    const year = new Date(item.publishTime).getFullYear()
    return { text: Number.isFinite(year) ? year.toString() : '' }
  }
  if (type === 'albumType+releaseYear') {
    let albumType = item.type
    if (item.type === 'EP/Single') {
      albumType = item.size === 1 ? 'Single' : 'EP'
    } else if (item.type === 'Single') {
      albumType = 'Single'
    } else if (item.type === '专辑') {
      albumType = 'Album'
    }
    const year = new Date(item.publishTime).getFullYear()
    return { text: Number.isFinite(year) ? `${albumType} · ${year}` : `${albumType}` }
  }
  if (type === 'creator') {
    return { text: item.creator?.nickname ? `by ${item.creator.nickname}` : '' }
  }
  return { text: '' }
}
</script>

<style scoped lang="scss">
.cover-item {
  color: var(--color-text);
  padding-bottom: 20px;
}
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
.cover-item.artist {
  display: flex;
  flex-direction: column;
  text-align: center;
  .cover {
    display: flex;
  }
  .title {
    margin-top: 2px;
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
