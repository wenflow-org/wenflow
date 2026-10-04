<script setup lang="ts">
/** 页首状态构成带（buckets）：值大字 + 标签 + 份额条 + 口径脚注，直接落页面无卡壳。
 *  判例 = 目标对话四桶（原型 bucketCard 类化，2026-10-04 用户拍板教学组统一此形态）。
 *  比例条 = 各桶占同一整体的份额（必须互斥构成，非同一整体不要硬套——假比例条纪律）；
 *  口径/补充说明走 foot（可见弱化文字）或 valueTitle（悬停），不新增计数复读。 */
interface MkBucketFoot {
  text: string
  title?: string
}
interface MkBucketItem {
  value: string | number
  label: string
  /** 份额条宽（%）；缺省 0 */
  pct?: number
  /** 条色（CSS 色值 / var(--mk-*)）；缺省 var(--mk-blue) */
  tone?: string
  /** 值悬停口径（如窗口估算说明） */
  valueTitle?: string
  /** 桶内脚注（可多条；title 为悬停口径） */
  foots?: MkBucketFoot[]
}

withDefaults(
  defineProps<{
    /** 构成桶组（error 模式下不需要） */
    items?: MkBucketItem[]
    /** 无障碍名（如「目标对话状态构成」） */
    label?: string
    /** 三态失败态（P1#6 判例收编）：传入即渲染「统计获取失败 · 重试」单桶，不静默消失 */
    error?: string
  }>(),
  { items: () => [] }
)

defineEmits<{ retry: [] }>()
</script>

<template>
  <!-- 失败态：文案判例 = GoalConversations「统计获取失败 · 重试」（retry 事件由页面接自己的重载） -->
  <section v-if="error" class="buckets" :aria-label="label">
    <div class="bucket">
      <span class="bucket__l">统计获取失败</span>
      <span class="bucket__l bucket__foot">{{ error }} · <button type="button" class="mk-link" @click="$emit('retry')">重试</button></span>
    </div>
  </section>
  <section v-else class="buckets" :aria-label="label">
    <div v-for="b in items" :key="b.label" class="bucket">
      <span class="bucket__v" :title="b.valueTitle ?? undefined">{{ b.value }}</span>
      <span class="bucket__l">{{ b.label }}</span>
      <span class="bucket__bar" aria-hidden="true"><i :style="{ width: (b.pct ?? 0) + '%', background: b.tone || 'var(--mk-blue)' }"></i></span>
      <span
        v-for="(f, i) in b.foots ?? []"
        :key="i"
        class="bucket__l bucket__foot"
        :title="f.title ?? undefined"
      >{{ f.text }}</span>
    </div>
  </section>
</template>

<style scoped>
/* 自 GoalConversations 类化后提升为共享原语（2026-10-04，原页 scoped 拷贝退役）：
   token 映射见该页迁移注记（--line→--mk-line、--surface→--mk-surface、--r-lg→--mk-radius-lg、
   --surface-3→--mk-surface-3、--muted→--mk-muted、--fs-micro→--mk-fs-micro）。 */
.buckets { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: var(--mk-space-3); }
.bucket { display: grid; gap: 3px; padding: 13px 15px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-lg); background: var(--mk-surface); }
.bucket__v { font-size: 28px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.bucket__l { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.bucket__bar { height: 4px; border-radius: 999px; background: var(--mk-surface-3); overflow: hidden; margin-top: 5px; }
.bucket__bar > i { display: block; height: 100%; border-radius: 999px; }
/* foot（原型 bucketCard 第 5 参 inline style 的类化）：弱化说明文字 */
.bucket__foot { color: var(--mk-faint); }
</style>
