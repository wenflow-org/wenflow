<template>
  <Teleport to="body">
    <div v-if="open" class="mk-drawer">
      <div ref="maskRef" class="mk-drawer__mask"></div>
      <aside ref="panelRef" class="mk-drawer__panel mk-drawer__panel--wide agd__panel" role="dialog" aria-label="运营术语表">
        <div class="mk-drawer__head">
          <div>
            <h3 class="mk-drawer__title">这是什么 · 运营术语表</h3>
            <span class="mk-drawer__sub">不懂的词在这里查一句话人话</span>
          </div>
          <button type="button" class="mk-drawer__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <!-- 加载失败：此前只 console.warn，界面全空显示「无匹配词条」，
             把接口失败伪装成没有词条；这里给原因 + 重试入口。
             放在 search 容器内（而非面板直属子节点）：.agd__panel 是
             grid-template-rows: auto auto 1fr（头/搜索/正文），
             多一个直属子节点会把正文挤出自适应行、塌高度不滚。 -->
        <div class="agd__search">
          <div v-if="loadError" class="agd__error" role="alert">
            <span class="agd__error-text">术语表加载失败：{{ loadError }}</span>
            <button type="button" class="mk-btn mk-btn--sm" @click="retryLoad">重试</button>
          </div>
          <input v-model="keyword" type="search" class="mk-input" placeholder="搜索术语 / 定义…" />
          <div class="mk-pills">
            <button
              v-for="c in categories"
              :key="c.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': category === c.id }"
              @click="category = c.id"
            >{{ c.label }}（{{ countOf(c.id) }}）</button>
          </div>
          <!-- 滚动修复 #10：分类锚点快速跳转（全部视图下显示；点击滚到对应分区） -->
          <div v-if="category === 'all'" class="agd__nav">
            <button
              v-for="s in NAV"
              :key="s.id"
              type="button"
              class="agd__nav-item"
              :class="{ 'is-active': activeSection === s.id }"
              @click="jumpToSection(s.id)"
            >{{ s.label }}</button>
          </div>
        </div>

        <div ref="bodyRef" class="mk-drawer__body agd__body" @scroll.passive="onBodyScroll">
          <template v-if="!loaded">
            <!-- mk 原语 loading（原 .agd__loading 手拼文案，无 spinner） -->
            <MkLoading text="术语表加载中…" />
          </template>
          <template v-else>
            <!-- 角色与流转 -->
            <section id="agd-sec-flow" v-if="showCategory('flow')" class="agd__section">
              <h4 class="agd__section-title">角色与流转</h4>
              <ul class="agd__list">
                <!-- 动态 promptRoles + 4 条固有角色语义（FLOW_EXTRAS）同口径过滤/计数 -->
                <li v-for="m in filteredRoles" :key="m.id" class="agd__term">
                  <span class="agd__term-name">
                    {{ m.label }}<span class="agd__term-en mono">{{ m.id }}</span>
                  </span>
                  <span class="agd__term-def">{{ m.hint }}</span>
                </li>
                <li v-if="filteredRoles.length === 0" class="agd__empty">无匹配词条</li>
              </ul>
            </section>

            <!-- 状态：完成度五档 + 三分语义 -->
            <section id="agd-sec-status" v-if="showCategory('status')" class="agd__section">
              <h4 class="agd__section-title">状态：完成度五档</h4>
              <ul class="agd__list">
                <li v-for="m in filteredCompletion" :key="m.status" class="agd__term">
                  <span class="agd__term-name">{{ m.label }}<span class="agd__term-en mono">{{ m.status }}</span></span>
                  <span class="agd__term-def">{{ m.hint }}</span>
                </li>
              </ul>
              <h4 class="agd__section-title">健康区三分语义</h4>
              <ul class="agd__list">
                <li v-for="s in filteredSemantics" :key="s.id" class="agd__term">
                  <span class="agd__term-name">{{ s.label }}<span class="agd__term-en mono">{{ s.id }}</span></span>
                  <span class="agd__term-def">{{ s.hint }}</span>
                </li>
              </ul>
            </section>

            <!-- 阶段 -->
            <section id="agd-sec-stage" v-if="showCategory('stage')" class="agd__section">
              <h4 class="agd__section-title">五个阶段</h4>
              <ul class="agd__list">
                <li v-for="s in filteredStages" :key="s.id" class="agd__term">
                  <span class="agd__term-name">{{ s.label }}<span class="agd__term-en mono">{{ s.id }}</span></span>
                  <span class="agd__term-def">{{ s.hint }}</span>
                </li>
              </ul>
            </section>

            <!-- 概念 / 健康词条 -->
            <section v-for="c in CATEGORY_SECTIONS" :key="c.id" v-show="showCategory(c.id)" class="agd__section" :id="`agd-sec-${c.id}`">
              <h4 class="agd__section-title">{{ c.label }}</h4>
              <ul class="agd__list">
                <li v-for="t in termsOf(c.id)" :key="t.term" class="agd__term">
                  <span class="agd__term-name">{{ t.term }}</span>
                  <span class="agd__term-def">{{ t.def }}<template v-if="t.where"> · <em class="agd__term-where">{{ t.where }}</em></template></span>
                </li>
                <li v-if="termsOf(c.id).length === 0" class="agd__empty">无匹配词条</li>
              </ul>
            </section>

            <!-- 文档链接 -->
            <section id="agd-sec-docs" v-if="filteredDocs.length" class="agd__section">
              <h4 class="agd__section-title">文档链接</h4>
              <ul class="agd__list">
                <li v-for="d in filteredDocs" :key="d.path" class="agd__term">
                  <span class="agd__term-name">{{ d.title }}<span class="agd__term-en mono">{{ d.path }}</span></span>
                  <span class="agd__term-def">{{ d.desc }}</span>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminGlossaryApi } from '@/api/adminApi'
import { COMPLETION_META, SEMANTICS_META, type GlossaryTerm } from './glossaryMeta'
import { errMsg } from './live'
import MkLoading from '@/components/mk/MkLoading.vue'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'

interface PromptRoleMeta { id: string; label: string; hint: string }
interface StageMeta { id: string; label: string; hint: string }

/** 字段角色的 4 条固有语义（render/handoff/internal/accumulate）：
    后端 glossary 接口未下发，但属运营必查词条。并入动态 promptRoles 同一数组，
    统一走 keyword 过滤与 flow 分类计数——此前它们裸渲染在模板里，
    搜「移交」搜不到、flow pill 计数也不含它们。 */
const FLOW_EXTRAS: PromptRoleMeta[] = [
  { id: 'render', label: 'render', hint: '字段是否对外可见：visible=会出现在对外交付，hidden=仅内部流转' },
  { id: 'handoff', label: 'handoff（移交）', hint: '字段产完后交给谁：可交给下一阶段（如 path）或指定 agent/skill；空=不转交' },
  { id: 'internal', label: 'internal（内部标记）', hint: '仅供平台内部/UI 控制使用，不进业务状态的字段标记' },
  { id: 'accumulate', label: 'accumulate（累积）', hint: '值会累积进学习者状态（画像/上下文），供后续阶段持续使用' },
]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const keyword = ref('')
const category = ref<CategoryId>('all')
const loaded = ref(false)
/** 加载失败原因（非空 = 顶部错误条 + 重试）；此前只 console.warn，界面静默全空 */
const loadError = ref('')
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)

useEscape(() => props.open, close)
useOverlay(computed(() => props.open), panelRef)
useMaskClose(maskRef, close)

const promptRoles = ref<PromptRoleMeta[]>([])
const completionStates = ref(COMPLETION_META)
const semantics = ref(SEMANTICS_META)
const stages = ref<StageMeta[]>([])
const terms = ref<GlossaryTerm[]>([])
const docs = ref<Array<{ title: string; path: string; desc: string }>>([])

const CATEGORY_SECTIONS = [
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康中心术语' },
] as const

type CategoryId = 'all' | 'concept' | 'flow' | 'status' | 'health' | 'stage'

const categories: Array<{ id: CategoryId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'flow', label: '角色流转' },
  { id: 'status', label: '状态' },
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康' },
  { id: 'stage', label: '阶段' },
]

/* 滚动修复 #10：分类锚点（全部视图下分区跳转 + 滚动高亮） */
const NAV: Array<{ id: string; label: string }> = [
  { id: 'flow', label: '角色流转' },
  { id: 'status', label: '状态' },
  { id: 'stage', label: '阶段' },
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康' },
  { id: 'docs', label: '文档' },
]
const bodyRef = ref<HTMLElement | null>(null)
const activeSection = ref('flow')

function jumpToSection(id: string) {
  const el = bodyRef.value?.querySelector<HTMLElement>(`#agd-sec-${id}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function onBodyScroll() {
  const body = bodyRef.value
  if (!body) return
  let current = NAV[0].id
  for (const s of NAV) {
    const el = body.querySelector<HTMLElement>(`#agd-sec-${s.id}`)
    if (el && el.offsetTop <= body.scrollTop + 240) current = s.id
  }
  activeSection.value = current
}

function showCategory(id: string) {
  // 全部视图 = 所有分区；单分类 = 只留命中那一格
  return category.value === 'all' || category.value === id
}

/** 角色与流转的完整口径：接口动态词条 + 4 条固有语义 */
const flowRoles = computed<PromptRoleMeta[]>(() => [...promptRoles.value, ...FLOW_EXTRAS])

function countOf(id: string) {
  if (id === 'all') return flowRoles.value.length + completionStates.value.length + semantics.value.length + stages.value.length + terms.value.length + docs.value.length
  /* flow 分类 = 动态 promptRoles + 固有语义 + terms 中 category='flow' 的词条（勿写死数量：静态/接口词条会增减） */
  if (id === 'flow') return flowRoles.value.length + terms.value.filter((t) => t.category === 'flow').length
  if (id === 'status') return completionStates.value.length + semantics.value.length
  if (id === 'stage') return stages.value.length
  return terms.value.filter((t) => t.category === id).length
}

function termsOf(id: 'concept' | 'health') {
  const kw = keyword.value.trim().toLowerCase()
  return terms.value.filter((t) => t.category === id && (!kw || t.term.toLowerCase().includes(kw) || t.def.toLowerCase().includes(kw)))
}

const kwLower = computed(() => keyword.value.trim().toLowerCase())

const filteredRoles = computed(() => flowRoles.value.filter((m) =>
  !kwLower.value || m.id.includes(kwLower.value) || m.label.includes(kwLower.value) || m.hint.includes(kwLower.value)))
const filteredCompletion = computed(() => completionStates.value.filter((m) =>
  !kwLower.value || m.status.includes(kwLower.value) || m.label.includes(kwLower.value) || m.hint.includes(kwLower.value)))
const filteredSemantics = computed(() => semantics.value.filter((s) =>
  !kwLower.value || s.id.includes(kwLower.value) || s.label.includes(kwLower.value) || s.hint.includes(kwLower.value)))
const filteredStages = computed(() => stages.value.filter((s) =>
  !kwLower.value || s.id.includes(kwLower.value) || s.label.includes(kwLower.value) || s.hint.includes(kwLower.value)))
const filteredDocs = computed(() => docs.value.filter((d) =>
  !kwLower.value || d.title.includes(kwLower.value) || d.path.includes(kwLower.value) || d.desc.includes(kwLower.value)))

async function load() {
  loaded.value = false
  loadError.value = ''
  try {
    const res = await adminGlossaryApi.get()
    const data = res.data?.data
    // 空响应等同失败：全部词条落空会让界面显示成「无匹配词条」，把故障说成没数据
    if (!data) {
      loadError.value = '接口未返回词条数据'
      return
    }
    promptRoles.value = data.promptRoles || []
    completionStates.value = data.completionStates || COMPLETION_META
    semantics.value = data.semantics || SEMANTICS_META
    stages.value = data.stages || []
    terms.value = data.terms || []
    docs.value = data.docs || []
  } catch (e) {
    // 失败必须可见：顶部错误条给原因 + 重试（此前仅 console.warn）
    loadError.value = errMsg(e)
  } finally {
    loaded.value = true
  }
}

/** 错误条「重试」：清掉搜索词重新拉一次，期间回到加载态 */
async function retryLoad() {
  keyword.value = ''
  activeSection.value = 'flow'
  await load()
}

watch(() => props.open, (o) => {
  if (o) {
    loaded.value = false
    keyword.value = ''
    loadError.value = ''
    activeSection.value = 'flow'
    void load()
  }
})
onMounted(() => { if (props.open) void load() })

function close() { emit('close') }
</script>

<style scoped>
/* 外壳（遮罩/面板/头/标题/关闭/正文/入场动画/z-index）全部由 .mk-drawer 体系提供，
   这里只留两处内容层差异：面板多一行「搜索+分类」、正文顶部留白（搜索行自带下边距）。
   2026-09-29 收敛：此前把外壳整套抄了一遍（连 4 个断点的宽度 token 都照抄），
   后果是宽度阶梯与共享档位脱钩（≥2800 该 1040 却停在 880）且 z-index 走的是 modal 层。 */
.agd__panel {
  grid-template-rows: auto auto 1fr;
}
.agd__search { display: grid; gap: 8px; padding: 6px 18px 12px; border-bottom: 1px solid var(--mk-line); }
/* 加载失败条（错误态：红系底 + role=alert，与全站 mk 错误态同语言） */
.agd__error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
.agd__error-text { flex: 1 1 auto; min-width: 0; }
/* 滚动修复 #10：分类锚点导航条（横向滚动小胶囊） */
.agd__nav { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.agd__nav-item {
  flex-shrink: 0;
  padding: 2px 10px; border: 1px solid transparent; border-radius: 999px;
  /* 底/字色走 token：原 #f1f5fb / #dbe9ff + 暗色补丁 #232325 三处硬编码已归 token */
  background: var(--mk-surface-2); color: var(--mk-muted); font: inherit; font-size: var(--mk-fs-micro); font-weight: 700; cursor: pointer;
}
.agd__nav-item:hover { color: var(--mk-blue); }
.agd__nav-item.is-active { background: color-mix(in srgb, var(--mk-blue) 22%, transparent); color: var(--mk-accent-deep); border-color: rgba(44, 99, 208, 0.35); }
.agd__body { padding-top: 6px; }
.agd__section { margin-top: 14px; }
/* 滚动修复 #10：分类标题吸顶（抽屉内部滚动时分区标题常驻顶部） */
.agd__section-title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 0 6px;
  padding: 4px 0 6px;
  /* token 化：原 #fff + 暗色补丁 #1b1c1d 两处硬编码（吸顶必须不透明，故不能用 color-mix） */
  background: var(--mk-surface);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
}
.agd__list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.agd__term { display: grid; gap: 1px; padding: 7px 10px; border-radius: var(--mk-radius-xl); background: var(--mk-surface-2); }
.agd__term-name { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.agd__term-en { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.agd__term-def { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.agd__term-where { font-style: normal; color: var(--mk-blue); }
.agd__empty { padding: 8px 0; color: var(--mk-faint); font-size: var(--mk-fs-micro); }

@media (min-width: 2000px) {
  .agd__search { padding: 8px 24px 14px; }
  .agd__nav-item { font-size: var(--mk-fs-micro); }
  .agd__body { padding: 8px 24px 24px; }
  .agd__section-title { font-size: var(--mk-fs-micro); }
  .agd__term-name { font-size: var(--mk-fs-body); }
  .agd__term-en { font-size: var(--mk-fs-micro); }
  .agd__term-def { font-size: var(--mk-fs-micro); }
  .agd__empty { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  /* 30 → 28：与壳层正文左右内边距同档（壳 2800 档是 28，此前两行内容左右错 2px） */
  .agd__search { padding: 10px 28px 16px; }
  .agd__nav-item { font-size: var(--mk-fs-micro); }
  .agd__body { padding: 10px 28px 30px; }
  .agd__section-title { font-size: var(--mk-fs-micro); }
  .agd__term-name { font-size: var(--mk-fs-body); }
  .agd__term-en { font-size: var(--mk-fs-micro); }
  .agd__term-def { font-size: var(--mk-fs-micro); }
  .agd__empty { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .agd__search { padding: 12px 36px 18px; }
  .agd__nav-item { font-size: var(--mk-fs-body); }
  .agd__body { padding: 12px 36px 36px; }
  .agd__section-title { font-size: var(--mk-fs-emphasis); }
  .agd__term-name { font-size: var(--mk-fs-emphasis); }
  .agd__term-en { font-size: var(--mk-fs-body); }
  .agd__term-def { font-size: var(--mk-fs-emphasis); }
  .agd__empty { font-size: var(--mk-fs-emphasis); }
}

/* ================= 暗色模式（D1 补完）：术语表抽屉 =================
   词条底已归 --mk-surface-2（token 自带暗色档），此处无页面私有补丁。 */
</style>
