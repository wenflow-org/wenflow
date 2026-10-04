<template>
  <div class="mk-distband">
    <div v-if="title || sub" class="mk-distband__head">
      <span v-if="title" class="mk-distband__title">{{ title }}</span>
      <span v-if="sub" class="mk-distband__sub">{{ sub }}</span>
    </div>
    <div class="stageband mk-distband__band" role="group" :aria-label="ariaLabel || title || '状态分布'">
      <template v-for="b in bins" :key="b.key">
        <span
          v-if="b.n > 0"
          role="button"
          tabindex="0"
          class="mk-distband__seg"
          :class="{ 'mk-distband__seg--on': activeKey === b.key }"
          :style="{ width: widthOf(b), background: b.tone }"
          :title="segTitle(b)"
          :aria-pressed="activeKey === b.key"
          @click="emit('select', b.key)"
          @keydown.enter.prevent="emit('select', b.key)"
        ></span>
      </template>
    </div>
    <div class="stageband__legend">
      <button
        v-for="b in bins"
        :key="b.key"
        type="button"
        class="sbl sbl--link"
        :class="{ 'sbl--on': activeKey === b.key }"
        :title="segTitle(b)"
        @click="emit('select', b.key)"
      >
        <span class="sbl__sw" :style="{ background: b.tone }" aria-hidden="true"></span>
        <span class="sbl__name">{{ b.label }}</span>
        <span class="sbl__n">{{ b.n }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 贴表分布条（2026-10-04 教学组标准件，学习状态页 confBand 升格共享）：
 *  宏观切片紧贴数据行（邻近原则）——分段与图例均可点击下钻筛选下方表格，再点取消。
 *  分段条数不藏悬停（图例恒显计数，含 0 值档；非零才出段）；
 *  偏态保护：非零段宽度下限 minPercent%（默认 3）+ min-width 14px，1 人也露出可点色标。 */
export interface MkDistBin {
  key: string
  label: string
  n: number
  /** CSS 颜色值（var(--mk-*) 或字面量） */
  tone: string
  /** 组内合并口径等补充说明，追加在悬停 title 里 */
  hint?: string
}

const props = withDefaults(
  defineProps<{
    bins: MkDistBin[]
    /** 当前下钻命中的 bin key（null = 全量） */
    activeKey?: string | null
    title?: string
    sub?: string
    /** 悬停/图例计数单位：人 / 条 / 位 */
    unit?: string
    ariaLabel?: string
    minPercent?: number
  }>(),
  { activeKey: null, title: '', sub: '', unit: '条', ariaLabel: '', minPercent: 3 }
)

const emit = defineEmits<{ (e: 'select', key: string): void }>()

function widthOf(b: MkDistBin): string {
  const total = props.bins.reduce((s, x) => s + x.n, 0) || 1
  return `${Math.max((b.n / total) * 100, props.minPercent)}%`
}
function segTitle(b: MkDistBin): string {
  return `${b.label}：${b.n} ${props.unit}${b.hint ? ' · ' + b.hint : ''} · 点击${props.activeKey === b.key ? '取消' : '只看'}`
}
</script>

<style scoped>
.mk-distband { display: grid; gap: 8px; }
.mk-distband__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.mk-distband__title { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.mk-distband__sub { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.mk-distband__band { height: 16px; }
.mk-distband__seg {
  cursor: pointer;
  min-width: 14px;
  transition: filter var(--mk-dur) var(--mk-ease-out), box-shadow var(--mk-dur) var(--mk-ease-out);
}
.mk-distband__seg:hover { filter: brightness(1.08); }
.mk-distband__seg--on { box-shadow: inset 0 0 0 2px var(--mk-surface), 0 0 0 1px var(--mk-ink); }
.mk-distband__seg:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
/* stageband__legend 全局有 margin-top:14px；组件用 grid gap 统一节奏，归零避免双倍间距 */
.mk-distband .stageband__legend { margin-top: 0; }
</style>
