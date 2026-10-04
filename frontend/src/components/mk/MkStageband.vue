<script setup lang="ts">
/** 状态构成条（堆叠条）：一条轨道按互斥份额分段，可选图例。
 *
 *  为什么是组件而不是纯样式类：段循环、图例、aria、tone→token 映射在每个消费页都要重写一遍。
 *  已实证的代价 —— OpsHub 自搓的 `.ow-state__seg` 与全局 `.stageband` 在**四项**上分叉
 *  （高度 8 vs 12、gap 0 vs 2、轨道色 --mk-line vs --mk-surface-3、子元素 i vs span），
 *  muted 档还写死了 #c3cbda / #404244（暗色另写一条）。组件只收口这些；
 *  外观仍由已收敛的全局原语承载（`.stageband` / `.stageband__legend` / `.sbl`，mk-primitives.css），
 *  所以本组件**不带视觉样式**，只负责结构与语义。
 *
 *  与 MkBuckets 的分工（同属「构成」族，选型规则）：
 *    要读出每项绝对数 / 页首统计带 → MkBuckets（砖：值大字 + 份额条）
 *    卡内「一个整体的构成」/ 细长条 → MkStageband（条）
 *    单值进度（完成度、占比单值）→ `.mk-minibar`
 *  纪律同 MkBuckets：**必须是互斥构成**（各段同属一个整体、和为 100%）；非同一整体不要硬套。
 *
 *  tone 用全站语义色词汇（传名字，或直接传 CSS 色值走原样）：
 *    blue = 进行中/正常 · ok = 完成 · warn = 到期/需关注 · bad = 失败 · faint = 下线/其它
 *  历史页面存在两套同义名字（brand/info 都指蓝、muted 指 faint），一并作别名收下 ——
 *  收敛时不再要求调用点改名，只要求新代码用上面五个正名。
 */
interface MkStagebandSegment {
  key: string
  /** 图例名（也用于默认 title：`${label} ${count}`） */
  label: string
  /** 图例数值（缺省不渲染数值列） */
  count?: number | string
  /** 段宽（如 '37%'）；缺省 0（该段不占宽，但仍在图例里如实出现） */
  pct?: string
  /** 语义色名或 CSS 色值；缺省 blue */
  tone?: string
  /** 覆盖默认 title */
  title?: string
}

const props = withDefaults(
  defineProps<{
    segments?: MkStagebandSegment[]
    /** 无障碍名（如「学习路径状态构成」）。给了才设 role=img；不给即纯装饰条 */
    label?: string
    /** 是否渲染图例（默认 true；页面自带行式图例时传 false） */
    legend?: boolean
    /** 轨道高度档：md=12（规范档）/ sm=8（卡内紧凑档）。只此两档，别在页面上再发明高度 */
    size?: 'md' | 'sm'
  }>(),
  { segments: () => [], legend: true, size: 'md' }
)

/** 语义色 → token。改色只改这里（各页不再各持一份 tone 表）。 */
const TONE_TOKEN: Record<string, string> = {
  blue: 'var(--mk-blue)',
  ok: 'var(--mk-green)',
  warn: 'var(--mk-amber)',
  bad: 'var(--mk-red)',
  faint: 'var(--mk-faint)',
  /* 历史别名（等价，收敛用） */
  brand: 'var(--mk-blue)',
  info: 'var(--mk-blue)',
  muted: 'var(--mk-faint)',
}
/** 认得出就翻 token，认不出按原样当 CSS 色值用（调用点可以直接传 var(--mk-purple)） */
const toneOf = (t?: string): string => (t ? TONE_TOKEN[t] ?? t : TONE_TOKEN.blue)
const titleOf = (s: MkStagebandSegment): string | undefined =>
  s.title ?? [s.label, s.count].filter((v) => v !== undefined && v !== '').join(' ')
</script>

<template>
  <div>
    <div
      class="stageband"
      :class="{ 'stageband--sm': props.size === 'sm' }"
      :role="props.label ? 'img' : undefined"
      :aria-label="props.label"
    >
      <span
        v-for="s in props.segments"
        :key="s.key"
        :style="{ width: s.pct ?? '0%', background: toneOf(s.tone) }"
        :title="titleOf(s)"
      ></span>
    </div>
    <div v-if="props.legend && props.segments.length" class="stageband__legend">
      <div v-for="s in props.segments" :key="s.key" class="sbl" :title="titleOf(s)">
        <span class="sbl__sw" :style="{ background: toneOf(s.tone) }" aria-hidden="true"></span>
        <span class="sbl__name">{{ s.label }}</span>
        <span v-if="s.count !== undefined" class="sbl__n">{{ s.count }}</span>
      </div>
    </div>
  </div>
</template>
