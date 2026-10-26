<template>
  <!-- 模型选择器（2026-10-20 走查：借鉴 OpenRouter / LiteLLM / Dify 的做法）。
       此前路由与 Skill 运行时都是「手填模型 ID + datalist」，运营必须记得住 id 才能配；
       成熟产品的共同形态是：可搜索、按供应商分组、每行带层级与能力徽标、价格可见。
       本组件只管选择与展示；「不单独指定、用平台默认」由 allowInherit 提供一条显式选项，
       不再依赖空输入框的隐含语义。 -->
  <div ref="rootEl" class="mk-mp" :class="{ 'mk-mp--open': open, 'mk-mp--up': openUp, 'mk-mp--disabled': disabled }">
    <button
      v-bind="$attrs"
      type="button"
      class="mk-mp__control"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :title="controlTitle"
      @click="toggle"
    >
      <span class="mk-mp__value mono" :class="{ 'mk-mp__value--empty': !modelValue }">{{ displayText }}</span>
      <ChevronDown :size="14" class="mk-mp__chev" aria-hidden="true" />
    </button>
    <!-- 清除钮必须与主按钮平级：嵌在 button 里是非法交互元素；而外层 <label> 会把整块点击
         转给第一个可标注的子控件——放进来那次，点选择器等于点了清除。 -->
    <button
      v-if="modelValue && !disabled"
      type="button"
      class="mk-mp__clear"
      aria-label="清除"
      @click.stop="clear"
    >✕</button>

    <Teleport to="body">
    <div v-if="open" ref="popEl" class="mk-mp__pop mk-mp__pop--fixed" :style="popStyle">
      <input
        ref="searchEl"
        v-model="query"
        type="text"
        class="mk-mp__search"
        placeholder="搜索模型、供应商，或直接输入模型 ID"
        autocomplete="off"
        @keydown="onKeydown"
      />
      <div ref="listEl" class="mk-mp__list" role="listbox" aria-label="可选模型">
        <template v-for="row in rows" :key="row.key">
          <div v-if="row.kind === 'group'" class="mk-mp__group">{{ row.label }}</div>
          <button
            v-else
            type="button"
            class="mk-mp__opt"
            :class="{
              'is-active': row.index === activeIndex,
              'is-selected': row.opt.value === modelValue,
              'is-mismatch': row.opt.tier && tier && row.opt.tier !== tier
            }"
            role="option"
            :aria-selected="row.opt.value === modelValue"
            @click="choose(row.opt)"
            @mousemove="activeIndex = row.index"
          >
            <span class="mk-mp__opt-main">
              <span class="mk-mp__id mono">{{ row.opt.value || row.opt.label }}</span>
              <span v-if="row.opt.value && row.opt.label && row.opt.label !== row.opt.value" class="mk-mp__opt-label">{{ row.opt.label }}</span>
              <span v-if="row.opt.note" class="mk-mp__opt-note">{{ row.opt.note }}</span>
            </span>
            <span class="mk-mp__meta">
              <span class="mk-mp__tags">
                <span v-if="row.opt.tier" class="mk-badge mk-badge--muted">{{ tierText(row.opt.tier) }}</span>
                <span v-if="row.opt.thinking" class="mk-badge mk-badge--muted" title="支持思考模式">思考</span>
                <span v-if="row.opt.reasoning" class="mk-badge mk-badge--muted" title="支持推理强度">强度</span>
                <span v-if="row.opt.vision" class="mk-badge mk-badge--muted" title="支持图片输入">视觉</span>
              </span>
              <span v-if="priceText(row.opt)" class="mk-mp__price mono">{{ priceText(row.opt) }}</span>
            </span>
          </button>
        </template>
        <div v-if="!optionRows.length" class="mk-mp__empty">
          {{ allowCustom && query.trim() ? '列表里没有这个模型' : '没有匹配的模型' }}
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * MkModelPicker：可搜索的模型选择器（原语）。
 *
 * 设计依据（2026-10-20 外部调研）：
 * - OpenRouter：模型（能力契约）与通道（谁提供）两层分开表达，选择时要能看见供应商；
 * - LiteLLM / Dify：模型从注册表里挑，而不是让运营背 id；「默认模型」是显式的一档；
 * - Azure AI Foundry：每个部署行都带配额/能力读数，选择与核对在同一视线内。
 *
 * 行为约定：
 * - 未选项由 allowInherit 提供「继承…」一行，空输入不再承担继承语义；
 * - allowCustom 允许把搜索词直接当模型 ID 提交（别名、聚合网关 id 等注册表外的合法值）；
 * - tier 只用于标注「层级不同」（该选项仍可选，由父组件决定是否同步层级），不做静默过滤。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

export interface MkModelOption {
  /** 模型 ID 或逻辑别名；空字符串 = 继承 */
  value: string
  label?: string
  tier?: string
  /** 分组名（缺省用 providerName，再缺省归到「模型」） */
  group?: string
  providerId?: string
  providerName?: string
  thinking?: boolean
  reasoning?: boolean
  vision?: boolean
  priceIn?: number | null
  priceOut?: number | null
  /** 行内补充说明（如「别名指向」） */
  note?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: MkModelOption[]
    placeholder?: string
    /** 展示「继承」行；选中即清空值 */
    allowInherit?: boolean
    inheritLabel?: string
    /** 允许把搜索词当模型 ID 提交 */
    allowCustom?: boolean
    /** 当前层级：仅用于标注层级不同的候选 */
    tier?: string | null
    /** 不可选的模型 ID（主模型、已选备用） */
    exclude?: string[]
    disabled?: boolean
  }>(),
  {
    placeholder: '选择模型',
    allowInherit: false,
    inheritLabel: '用平台默认模型',
    allowCustom: true,
    tier: null,
    exclude: () => [],
    disabled: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  pick: [option: MkModelOption | null]
}>()

defineOptions({ inheritAttrs: false })

const rootEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
/** fixed 定位的候选层：卡片与滚动容器普遍 overflow:hidden，绝对定位会被卡片边缘裁掉 */
const popPos = ref<{ left: number; width: number; top?: number; bottom?: number }>({ left: 0, width: 430 })
const popStyle = computed(() => {
  const p = popPos.value
  return {
    left: `${p.left}px`,
    width: `${p.width}px`,
    ...(p.top != null ? { top: `${p.top}px` } : {}),
    ...(p.bottom != null ? { bottom: `${p.bottom}px` } : {})
  }
})

function place(): void {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(Math.max(rect.width, 430), Math.max(320, window.innerWidth - 32))
  const below = window.innerHeight - rect.bottom
  openUp.value = below < 320 && rect.top > below
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
  popPos.value = openUp.value
    ? { left, width, bottom: window.innerHeight - rect.top + 5 }
    : { left, width, top: rect.bottom + 5 }
}
const open = ref(false)
/** 候选层向上展开：控件贴近视口底部时向下会被裁掉（Skill 运行时的模型字段就在折线附近） */
const openUp = ref(false)
const query = ref('')
const activeIndex = ref(-1)

const selectedMeta = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null)
const displayText = computed(() => {
  if (props.modelValue) return props.modelValue
  return props.allowInherit ? props.inheritLabel : props.placeholder
})
/** 关闭态只显示模型 ID（长 ID 在窄列里会被显示名挤成省略号）；显示名进 title 与候选行 */
const controlTitle = computed(() => {
  if (!props.modelValue) return displayText.value
  const label = selectedMeta.value?.label
  return label && label !== props.modelValue ? `${props.modelValue} · ${label}` : props.modelValue
})

function priceText(o: MkModelOption): string {
  const hasIn = typeof o.priceIn === 'number'
  const hasOut = typeof o.priceOut === 'number'
  if (!hasIn && !hasOut) return ''
  return `入 ${hasIn ? o.priceIn : '—'} / 出 ${hasOut ? o.priceOut : '—'}`
}

/** 层级是后端枚举码（chat / reasoning），上屏走中文；未知值原样保留，避免硬造词 */
const TIER_TEXT: Record<string, string> = { chat: '对话', reasoning: '推理' }
function tierText(t?: string): string {
  return t ? TIER_TEXT[t] ?? t : ''
}

/** 过滤后的候选（继承行不参与过滤，始终置顶） */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const excluded = new Set(props.exclude)
  return props.options.filter((o) => {
    if (!o.value || excluded.has(o.value)) return false
    if (!q) return true
    return [o.value, o.label, o.providerName, o.group]
      .some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
  })
})

type Row =
  | { kind: 'group'; label: string; key: string }
  | { kind: 'option'; opt: MkModelOption; index: number; key: string }

/** 扁平行 + 分组头；键盘导航只走 option 行 */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const q = query.value.trim()
  let optionIndex = 0
  const pushOption = (opt: MkModelOption) => {
    out.push({ kind: 'option', opt, index: optionIndex, key: `o-${optionIndex}-${opt.value}` })
    optionIndex += 1
  }
  if (props.allowInherit) pushOption({ value: '', label: props.inheritLabel })
  let lastGroup = ''
  for (const opt of filtered.value) {
    const group = opt.group || opt.providerName || '模型'
    if (group !== lastGroup) {
      out.push({ kind: 'group', label: group, key: `g-${group}-${out.length}` })
      lastGroup = group
    }
    pushOption(opt)
  }
  // 只有候选全被过滤掉时才提供「按输入使用」：有命中时再补一行同词条，只是噪音
  if (props.allowCustom && q && filtered.value.length === 0 && !props.exclude.includes(q)) {
    pushOption({ value: q, label: '按输入的模型 ID 使用', note: '注册表外的值' })
  }
  return out
})

const optionRows = computed(() => rows.value.filter((r): r is Extract<Row, { kind: 'option' }> => r.kind === 'option'))

function openList(): void {
  if (props.disabled) return
  open.value = true
  query.value = ''
  // 没有当前值时先不预激活：第一次 ↓ 应落在第一行，而不是跳过它
  const selected = optionRows.value.findIndex((r) => r.opt.value === props.modelValue)
  activeIndex.value = selected >= 0 ? optionRows.value[selected].index : -1
  place()
  void nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = 0
    searchEl.value?.focus()
  })
}

function close(): void {
  open.value = false
  query.value = ''
  activeIndex.value = -1
}

function toggle(): void {
  if (open.value) close()
  else openList()
}

function choose(opt: MkModelOption): void {
  emit('update:modelValue', opt.value)
  // 继承行 = 没有模型，不是「选了一个空 id」
  emit('pick', opt.value ? opt : null)
  close()
}

function clear(): void {
  emit('update:modelValue', '')
  emit('pick', null)
}

function move(delta: number): void {
  if (!optionRows.value.length) return
  const current = optionRows.value.findIndex((r) => r.index === activeIndex.value)
  const next = current < 0 ? 0 : (current + delta + optionRows.value.length) % optionRows.value.length
  activeIndex.value = optionRows.value[next].index
}

function onKeydown(e: KeyboardEvent): void {
  // 弹层内的按键不回传给页面：后台的 Esc 是「关闭二级页」，在这里按 Esc 只应收起候选
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1) }
  else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    const hit = optionRows.value.find((r) => r.index === activeIndex.value)
    if (hit) choose(hit.opt)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

function onDocDown(e: MouseEvent): void {
  const t = e.target as Node
  if (rootEl.value?.contains(t) || popEl.value?.contains(t)) return
  close()
}

/** 页面滚动会让 fixed 候选层脱离控件：重新贴回控件（候选层内部的滚动不算） */
function onScroll(e: Event): void {
  const t = e.target as Node | null
  if (t && popEl.value?.contains(t)) return
  if (open.value) place()
}

watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
  } else {
    document.removeEventListener('mousedown', onDocDown)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<style scoped>
.mk-mp { position: relative; min-width: 0; }
.mk-mp__control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 9px 38px 9px 11px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-body);
  text-align: left;
  cursor: pointer;
}
.mk-mp__control:hover { background: var(--mk-surface-2); }
.mk-mp__control:focus-visible { border-color: var(--mk-blue); box-shadow: var(--mk-focus-ring); outline: none; }
.mk-mp--open .mk-mp__control { border-color: var(--mk-blue); box-shadow: var(--mk-focus-ring); }
.mk-mp__control:disabled { opacity: 0.55; cursor: not-allowed; }
.mk-mp__value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-mp__value--empty { color: var(--mk-faint); font-family: inherit; }
.mk-mp__clear {
  position: absolute;
  top: 50%;
  right: 24px;
  transform: translateY(-50%);
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.mk-mp__clear:hover { color: var(--mk-ink); }
.mk-mp__chev { flex: none; margin-left: auto; color: var(--mk-faint); }

.mk-mp__pop {
  position: fixed;
  z-index: 1200;
  /* 宽度由 place() 按控件宽度与视口计算（最小 430：候选行要放 ID + 徽标 + 单价） */
  display: grid;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-pop);
}
.mk-mp__search {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-body);
  outline: none;
}
.mk-mp__search:focus { border-color: var(--mk-blue); }
.mk-mp__list { max-height: 320px; overflow-y: auto; display: grid; gap: 2px; }
.mk-mp__group {
  padding: 6px 8px 2px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.mk-mp__opt {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--mk-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mk-mp__opt.is-active { background: var(--mk-surface-2); }
.mk-mp__opt.is-selected { box-shadow: inset 2px 0 0 var(--mk-blue); }
.mk-mp__opt.is-mismatch .mk-mp__id { color: var(--mk-muted); }
.mk-mp__opt-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.mk-mp__id { font-size: var(--mk-fs-body); overflow-wrap: anywhere; }
.mk-mp__opt-label { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.mk-mp__opt-note { color: var(--mk-amber); font-size: var(--mk-fs-micro); }
.mk-mp__meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.mk-mp__tags { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mk-mp__price { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
.mk-mp__empty { padding: 14px 8px; color: var(--mk-faint); font-size: var(--mk-fs-micro); text-align: center; }
@media (max-width: 720px) {
  .mk-mp__pop { width: 100%; max-width: none; }
  .mk-mp__price { display: none; }
}
</style>
