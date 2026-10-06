<template>
  <div class="mk-subtabs" role="tablist" @keydown="onKeydown">
    <button
      v-for="(t, i) in tabs"
      :key="t.key"
      :ref="(el) => setTabRef(el, i)"
      type="button"
      role="tab"
      class="mk-subtab"
      :aria-selected="t.key === modelValue"
      :tabindex="t.key === modelValue ? 0 : -1"
      @click="$emit('update:modelValue', t.key)"
    >
      {{ t.label }}<span v-if="t.count !== undefined" class="mk-subtab__count">{{ t.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情页二级页签（newui/admin 原型 subtabs 形态）：下划线式，置于详情 hero 之下，
 * 把详情页的并列分区（会话/目标/许可…）收成分区页签。内容区用 v-show 保持已加载状态。
 * count：可选角标（如 VirtualProfile「数量即 tab 角标」决策），faint 微字不抢层级。
 * 类型 number | string（2026-10-02）：UserDetail 会话角标需「最近 5 / 共 40」口径文案——
 * 裸数字角标曾把 limit 窗口条数冒充总数（P1#14）；既有数字调用方不受影响。
 *
 * 键盘契约（2026-10-06 审核修复）：声明了 role=tablist/role=tab 就必须兑现 tablist 语义——
 * 方向键在页签间移动并切换、roving tabindex（仅选中项可 Tab 进入）、Home/End 跳首尾。
 * 此前 9 个页签全部落在 Tab 序里逐个通过、方向键无反应，属「半套 ARIA」。
 */
import { ref } from 'vue'

const props = defineProps<{ tabs: Array<{ key: string; label: string; count?: number | string }>; modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', key: string): void }>();

const tabEls = ref<(HTMLButtonElement | null)[]>([])
function setTabRef(el: unknown, i: number) {
  tabEls.value[i] = (el as HTMLButtonElement) || null
}

function activate(i: number) {
  const t = props.tabs[i]
  if (!t) return
  emit('update:modelValue', t.key)
  // 焦点跟随选中：切换后把焦点移到新页签（ARIA tabs 的 manual 激活惯例）
  requestAnimationFrame(() => tabEls.value[i]?.focus())
}

function onKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = props.tabs.length
  if (!n) return
  const cur = props.tabs.findIndex((t) => t.key === props.modelValue)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % n
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  e.preventDefault()
  activate(next)
}
</script>

<style scoped>
.mk-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--mk-line);
  /* 勿用 overflow-x:auto 横滚：定高 grid 页（.mk-page）的 auto 行轨按「最小贡献」收缩，
     overflow 非 visible 会把贡献清零 → 组件被压成 1px、页签被裁剪到点不到
     （LearnerDetail 实测，min-height:max-content 也救不回）。窄屏放不下时换行。 */
}
.mk-subtab {
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: var(--mk-fs-micro, 12px);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.mk-subtab:hover { color: var(--mk-ink); }
.mk-subtab[aria-selected='true'] {
  color: var(--mk-blue);
  border-bottom-color: var(--mk-blue);
}
.mk-subtab:focus-visible { outline: none; box-shadow: var(--mk-focus-ring); }
.mk-subtab__count { margin-left: 5px; color: var(--mk-faint); font-weight: 600; }
.mk-subtab[aria-selected='true'] .mk-subtab__count { color: inherit; opacity: 0.72; }
</style>
