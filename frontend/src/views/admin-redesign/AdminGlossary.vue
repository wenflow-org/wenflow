<template>
  <div class="mk-page mk-page--fill mg">
    <!-- 页头：标题 + 一句定位（2026-10-10 用户拍板：术语表从抽屉改为独立页——
         83 条词条是参考资料不是弹层，整页才有阅读宽度、可深链、可 Ctrl+F） -->
    <header class="mg__head">
      <h1 class="mg__title">运营术语表</h1>
      <p class="mg__sub">平台术语 · 口径与缩写速查</p>
    </header>

    <!-- 吸顶工具条：搜索 + 分类（计数跟随过滤，与原抽屉同口径） -->
    <div class="mg__toolbar">
      <input v-model="keyword" type="search" class="mk-input mg__search" placeholder="搜索术语 / 英文标识 / 定义" />
      <div class="mk-pills">
        <button
          v-for="c in categories"
          :key="c.id"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': category === c.id }"
          :aria-pressed="category === c.id"
          @click="category = c.id"
        >{{ c.label }}（{{ countOf(c.id) }}）</button>
      </div>
    </div>

    <!-- 加载失败：给原因 + 重试（接口失败不能伪装成「无匹配词条」） -->
    <div v-if="loadError" class="mg__error" role="alert">
      <span class="mg__error-text">术语表加载失败：{{ loadError }}</span>
      <button type="button" class="mk-btn mk-btn--sm" @click="retryLoad">重试</button>
    </div>

    <MkLoading v-if="!loaded" text="术语表加载中…" />

    <template v-else>
      <!-- 搜索时空分区整体隐藏（不渲染「无匹配词条」行海），全部为零时给一条全局空态 -->
      <!-- 角色与流转 -->
      <section v-if="showCategory('flow') && (!searching || filteredRoles.length)" class="mg__section">
        <h4 class="mg__section-title">角色与流转</h4>
        <div class="mg__grid">
          <div v-for="m in filteredRoles" :key="m.id" class="mg__term">
            <span class="mg__term-name">{{ m.label }}<span class="mg__term-en mono">{{ m.id }}</span></span>
            <span class="mg__term-def">{{ m.hint }}</span>
          </div>
        </div>
        <p v-if="!searching && filteredRoles.length === 0" class="mg__empty">无匹配词条</p>
      </section>

      <!-- 状态：完成度五档 + 健康区三分语义 -->
      <section v-if="showCategory('status') && (!searching || filteredCompletion.length + filteredSemantics.length)" class="mg__section">
        <template v-if="!searching || filteredCompletion.length">
          <h4 class="mg__section-title">状态：完成度五档</h4>
          <div class="mg__grid">
            <div v-for="m in filteredCompletion" :key="m.status" class="mg__term">
              <span class="mg__term-name">{{ m.label }}<span class="mg__term-en mono">{{ m.status }}</span></span>
              <span class="mg__term-def">{{ m.hint }}</span>
            </div>
          </div>
          <p v-if="!searching && filteredCompletion.length === 0" class="mg__empty">无匹配词条</p>
        </template>
        <template v-if="!searching || filteredSemantics.length">
          <h4 class="mg__section-title">健康区三分语义</h4>
          <div class="mg__grid">
            <div v-for="s in filteredSemantics" :key="s.id" class="mg__term">
              <span class="mg__term-name">{{ s.label }}<span class="mg__term-en mono">{{ s.id }}</span></span>
              <span class="mg__term-def">{{ s.hint }}</span>
            </div>
          </div>
          <p v-if="!searching && filteredSemantics.length === 0" class="mg__empty">无匹配词条</p>
        </template>
      </section>

      <!-- 阶段 -->
      <section v-if="showCategory('stage') && (!searching || filteredStages.length)" class="mg__section">
        <h4 class="mg__section-title">五个阶段</h4>
        <div class="mg__grid">
          <div v-for="s in filteredStages" :key="s.id" class="mg__term">
            <span class="mg__term-name">{{ s.label }}<span class="mg__term-en mono">{{ s.id }}</span></span>
            <span class="mg__term-def">{{ s.hint }}</span>
          </div>
        </div>
        <p v-if="!searching && filteredStages.length === 0" class="mg__empty">无匹配词条</p>
      </section>

      <!-- 概念 / 健康词条 -->
      <section v-for="c in CATEGORY_SECTIONS" :key="c.id" v-show="showCategory(c.id) && (!searching || termsOf(c.id).length)" class="mg__section">
        <h4 class="mg__section-title">{{ c.label }}</h4>
        <div class="mg__grid">
          <div v-for="t in termsOf(c.id)" :key="t.term" class="mg__term">
            <span class="mg__term-name">{{ t.term }}</span>
            <span class="mg__term-def">{{ t.def }}<em v-if="t.where" class="mg__term-where"> · {{ t.where }}</em></span>
          </div>
        </div>
        <p v-if="!searching && termsOf(c.id).length === 0" class="mg__empty">无匹配词条</p>
      </section>

      <!-- 全局空态：搜索无任何命中 -->
      <div v-if="searching && totalHits === 0" class="mg__global-empty">
        没有匹配「{{ keyword.trim() }}」的词条，换个关键词试试。
      </div>

      <!-- 文档链接：只在「全部」视图出现（是延伸阅读不是词条） -->
      <section v-if="category === 'all' && !searching && filteredDocs.length" class="mg__section">
        <h4 class="mg__section-title">文档链接</h4>
        <div class="mg__grid">
          <div v-for="d in filteredDocs" :key="d.path" class="mg__term">
            <span class="mg__term-name">{{ d.title }}<span class="mg__term-en mono">{{ d.path }}</span></span>
            <span class="mg__term-def">{{ d.desc }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 运营术语表（整页版，2026-10-10 用户拍板：替换 AdminGlossaryDrawer 抽屉）。
 * 数据源不变：GET /api/admin/glossary（后端真源）+ glossaryMeta 兜底。
 * 与抽屉的差异只在呈现层：整页阅读宽度、词条卡片双列栅格、吸顶搜索、URL 可深链
 * （/admin/glossary?cat=&q= 与场景路由双向同步由 AdminConsole 既有机制承担）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { adminGlossaryApi } from '@/api/adminApi'
import { COMPLETION_META, SEMANTICS_META, type GlossaryTerm } from './glossaryMeta'
import { errMsg } from './live'
import MkLoading from '@/components/mk/MkLoading.vue'

interface PromptRoleMeta { id: string; label: string; hint: string }
interface StageMeta { id: string; label: string; hint: string }

/** 字段角色的 4 条固有语义（render/handoff/internal/accumulate）：
    后端 glossary 接口未下发，但属运营必查词条。并入动态 promptRoles 同一数组，
    统一走 keyword 过滤与 flow 分类计数（沿袭自抽屉版，勿拆出裸渲染）。 */
const FLOW_EXTRAS: PromptRoleMeta[] = [
  { id: 'render', label: 'render', hint: '字段是否对外可见：visible=会出现在对外交付，hidden=仅内部流转' },
  { id: 'handoff', label: 'handoff（移交）', hint: '字段产完后交给谁：可交给下一阶段（如 path）或指定 agent/skill。空=不转交' },
  { id: 'internal', label: 'internal（内部标记）', hint: '仅供平台内部/UI 控制使用，不进业务状态的字段标记' },
  { id: 'accumulate', label: 'accumulate（累积）', hint: '值会累积进学习者状态（画像/上下文），供后续阶段持续使用' },
]

const keyword = ref('')
const category = ref<CategoryId>('all')
const loaded = ref(false)
/** 加载失败原因（非空 = 错误条 + 重试） */
const loadError = ref('')

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

function showCategory(id: string) {
  // 全部视图 = 所有分区；单分类 = 只留命中那一格
  return category.value === 'all' || category.value === id
}

/** 角色与流转的完整口径：接口动态词条 + 4 条固有语义 */
const flowRoles = computed<PromptRoleMeta[]>(() => [...promptRoles.value, ...FLOW_EXTRAS])

function countOf(id: string) {
  /* 计数只统计正文真正渲染的集合（filteredX / termsOf 均自带关键词过滤）：
     category='flow'/'status' 的动态词条在正文没有渲染位（flow 格渲染角色卡、status 格渲染
     完成度/语义卡），过去计入会使 pill 数字大于实际卡片数（走查 #31：全部 84 实渲染 58） */
  if (id === 'all') {
    return filteredRoles.value.length + filteredCompletion.value.length + filteredSemantics.value.length
      + filteredStages.value.length + termsOf('concept').length + termsOf('health').length + filteredDocs.value.length
  }
  if (id === 'flow') return filteredRoles.value.length
  if (id === 'status') return filteredCompletion.value.length + filteredSemantics.value.length
  if (id === 'stage') return filteredStages.value.length
  return termsOf(id as 'concept' | 'health').length
}

function termsOf(id: 'concept' | 'health') {
  const kw = keyword.value.trim().toLowerCase()
  return terms.value.filter((t) => t.category === id && (!kw || t.term.toLowerCase().includes(kw) || t.def.toLowerCase().includes(kw)))
}

const kwLower = computed(() => keyword.value.trim().toLowerCase())
/** 搜索态：分区隐藏与全局空态的开关 */
const searching = computed(() => !!kwLower.value)
const totalHits = computed(() => countOf('all'))

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
      loadError.value = '未取到词条数据'
      return
    }
    promptRoles.value = data.promptRoles || []
    completionStates.value = data.completionStates || COMPLETION_META
    semantics.value = data.semantics || SEMANTICS_META
    stages.value = data.stages || []
    terms.value = data.terms || []
    docs.value = data.docs || []
  } catch (e) {
    loadError.value = errMsg(e)
  } finally {
    loaded.value = true
  }
}

/** 错误条「重试」：清掉搜索词重新拉一次 */
async function retryLoad() {
  keyword.value = ''
  await load()
}

const route = useRoute()

onMounted(() => {
  /* 深链 ?q=<术语>（成就卡术语链接 / 外部分享）→ 预填搜索，落点即所查词条；
     分类保持「全部」，避免词条被当前分类格隐藏 */
  const q = route.query.q
  if (typeof q === 'string' && q.trim()) keyword.value = q.trim()
  void load()
})
</script>

<style scoped>
.mg__head { margin-bottom: 14px; }
.mg__title { margin: 0 0 2px; font-size: var(--mk-fs-20); font-weight: 800; color: var(--mk-ink); }
.mg__sub { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 吸顶工具条：整页下滚时搜索/分类常驻（顶栏高度由壳层内容区决定，top:0 即内容区顶） */
.mg__toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 14px;
  padding: 10px 0;
  background: var(--mk-bg);
  border-bottom: 1px solid var(--mk-line);
}
.mg__search { flex: 0 1 320px; min-width: 200px; }
.mk-pills { display: flex; flex-wrap: wrap; gap: 6px; }

.mg__error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 14px;
  padding: 8px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
.mg__error-text { flex: 1 1 auto; min-width: 0; }

.mg__section { margin: 0 0 26px; }
.mg__section-title {
  margin: 0 0 8px;
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
}
/* 词条卡片栅格：整页宽度下双列起步，宽屏自动升三列 */
.mg__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 8px;
}
.mg__term {
  display: grid;
  gap: 3px;
  align-content: start;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
}
.mg__term-name { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.mg__term-en { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.mg__term-def { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
.mg__term-where { font-style: normal; color: var(--mk-blue); }
.mg__empty { margin: 4px 0 0; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.mg__global-empty {
  margin: 32px 0;
  padding: 24px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-modal);
  text-align: center;
  color: var(--mk-faint);
  font-size: var(--mk-fs-body);
}

@media (min-width: 2000px) {
  .mg__title { font-size: var(--mk-fs-emphasis); }
  .mg__grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
}
</style>
