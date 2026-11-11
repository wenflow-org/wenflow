<template>
  <div class="mk-page mk-page--fill mg">
    <!-- 页头：标题 + 一句定位（2026-10-10 用户拍板：术语表从抽屉改为独立页——
         几十张词条卡是参考资料不是弹层，整页才有阅读宽度、可深链、可 Ctrl+F） -->
    <header class="mg__head">
      <h1 class="mg__title">运营术语表</h1>
    </header>

    <!-- 加载失败只给原因和重试：半套词条照常渲染时，没加载出来的分组会读成「没有这个词条」。
         红底错误条走共享 .mk-alert--row（与 Addons / 执行日志同一件），不再自搓红盒。 -->
    <div v-if="loadError" class="mk-alert mk-alert--row" role="alert">
      <div class="mk-alert__msg">
        <p class="mg__error-title">术语表加载失败</p>
        <p class="mg__error-text">{{ loadError }}。没加载出来的词条不在此列出，不代表没有这个词条。</p>
      </div>
      <div class="mk-alert__act">
        <button type="button" class="mk-btn mk-btn--sm" @click="retryLoad">重试</button>
      </div>
    </div>

    <MkLoading v-if="!loaded" text="术语表加载中…" />

    <template v-else-if="!loadError">
      <!-- 吸顶工具条：搜索 + 分类。分类数字是词条库规模，搜索时整组隐去，
           否则「全部 (1)」会被读成这一类只有一条。 -->
      <div class="mg__toolbar">
        <input v-model="keyword" type="search" class="mk-input mg__search" placeholder="搜索术语 / 英文标识 / 定义" aria-label="搜索术语 / 英文标识 / 定义" />
        <!-- 2026-10-27 用户「需要统一调整」：分类是单选维度 → 胶囊下拉；
             原先一排常驻 chip 在窄屏折成多行，且与全站维度筛选不是同一控件。 -->
        <MkPillSelect
          v-model="categorySelect"
          label="分类"
          aria-label="按术语分类筛选"
          :options="categorySelectOptions"
          :active="category !== 'all'"
        />
      </div>

      <!-- 分组目录：几十张卡平铺时没有入口只能一路滚；搜索/单分类视图下分组不全，目录随之收起 -->
      <nav v-if="category === 'all' && !searching" class="mg__toc" aria-label="分组跳转">
        <a
          v-for="g in tocGroups"
          :key="g.id"
          class="mg__toc-item"
          :href="`#mg-${g.id}`"
          @click.prevent="jumpTo(g.id)"
        >
          {{ g.label }}<span class="mg__toc-count">{{ countOf(g.id) }}</span>
        </a>
      </nav>

      <p v-if="searching" class="mg__result-line">「{{ keyword.trim() }}」命中 {{ hitCount }} 条</p>

      <!-- 角色与流转 -->
      <section v-if="showCategory('flow') && filteredRoles.length" id="mg-flow" class="mg__section">
        <h2 class="mg__section-title" tabindex="-1">角色与流转</h2>
        <div class="mg__grid">
          <div v-for="m in filteredRoles" :key="m.id" class="mg__term">
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(m.label)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span class="mg__term-en mono">{{ m.id }}</span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(m.hint)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>
        </div>
      </section>

      <!-- 完成度五档 -->
      <section v-if="showCategory('status') && filteredCompletion.length" id="mg-status" class="mg__section">
        <h2 class="mg__section-title" tabindex="-1">完成度五档</h2>
        <div class="mg__grid">
          <div v-for="m in filteredCompletion" :key="m.status" class="mg__term">
            <!-- 右侧是机器串（draft / live），等宽展示，便于和接口字段对位 -->
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(m.label)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span class="mg__term-en mono">{{ m.status }}</span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(m.hint)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>
        </div>
      </section>

      <!-- 健康区三分语义 -->
      <section v-if="showCategory('semantics') && filteredSemantics.length" id="mg-semantics" class="mg__section">
        <h2 class="mg__section-title" tabindex="-1">健康区三分语义</h2>
        <div class="mg__grid">
          <div v-for="s in filteredSemantics" :key="s.id" class="mg__term">
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(s.label)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span class="mg__term-en mono">{{ s.id }}</span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(s.hint)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>
        </div>
      </section>

      <!-- 五个阶段 -->
      <section v-if="showCategory('stage') && filteredStages.length" id="mg-stage" class="mg__section">
        <h2 class="mg__section-title" tabindex="-1">五个阶段</h2>
        <div class="mg__grid">
          <div v-for="s in filteredStages" :key="s.id" class="mg__term">
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(s.label)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span class="mg__term-en mono">{{ s.id }}</span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(s.hint)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>
        </div>
      </section>

      <!-- 概念 / 健康中心术语 -->
      <section
        v-for="c in CATEGORY_SECTIONS"
        :id="`mg-${c.id}`"
        :key="c.id"
        v-show="showCategory(c.id) && termsOf(c.id).length"
        class="mg__section"
      >
        <h2 class="mg__section-title" tabindex="-1">{{ c.label }}</h2>
        <div class="mg__grid">
          <div v-for="t in termsOf(c.id)" :key="t.term" class="mg__term">
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(t.term)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(t.def)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template><em v-if="t.where" class="mg__term-where"> · {{ t.where }}</em></span>
          </div>
        </div>
      </section>

      <!-- 文档链接：延伸阅读，也参与搜索与分类筛选（不再只挂在「全部」里） -->
      <section v-if="showCategory('docs') && filteredDocs.length" id="mg-docs" class="mg__section">
        <h2 class="mg__section-title" tabindex="-1">文档链接</h2>
        <div class="mg__grid">
          <div v-for="d in filteredDocs" :key="d.path" class="mg__term">
            <span class="mg__term-name"><span class="mg__term-text"><template v-for="(seg, i) in hlSegs(d.title)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span class="mg__term-en mono">{{ d.path }}</span></span>
            <span class="mg__term-def"><template v-for="(seg, i) in hlSegs(d.desc)" :key="i"><mark v-if="seg.hit" class="mg__hl">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>
        </div>
      </section>

      <!-- 空态：搜索无命中或所选分类无词条时，给出口而不只是一行灰字。
           走共享 MkEmptyState（图标 + 为什么空 + 下一步），与全站空态同一件。 -->
      <MkEmptyState
        v-if="visibleCount === 0"
        :title="searching ? `没有匹配「${keyword.trim()}」的词条` : '这个分组暂时没有词条'"
        :description="searching
          ? `术语表共 ${countOf('all')} 条词条，可清空搜索，或直接查看全部。`
          : `全部 ${countOf('all')} 条词条分布在其他分组。`"
      >
        <div v-if="searching || category !== 'all'" class="mg__empty-actions">
          <button v-if="searching" type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="clearSearch">清空搜索</button>
          <button v-if="category !== 'all'" type="button" class="mk-btn mk-btn--sm" @click="showAll">查看全部词条</button>
        </div>
      </MkEmptyState>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 运营术语表（整页版，2026-10-10 用户拍板：替换 AdminGlossaryDrawer 抽屉）。
 * 数据源是 GET /api/admin/glossary（后端真源）：完成度、语义、词条全部由接口下发，
 * 本页不再留一份同名中文副本——之前接口失败时回退到前端副本，同一英文 id 就在两屏上
 * 显出两套中文叫法。呈现层：整页阅读宽度、词条卡片栅格、吸顶搜索、URL 可深链
 * （/admin/glossary?cat=&q= 在本页双向同步：挂载读取、筛选变化 replace 回写）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminGlossaryApi } from '@/api/adminApi'
import type { CompletionMeta, GlossaryTerm } from './glossaryMeta'
import { errMsg } from './live'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'

interface PromptRoleMeta { id: string; label: string; hint: string }
interface StageMeta { id: string; label: string; hint: string }
interface SemanticsMeta { id: string; label: string; hint: string }

/** 字段角色的 4 条固有语义（render/handoff/internal/accumulate）：
    后端 glossary 接口未下发，但属运营必查词条。并入动态 promptRoles 同一数组，
    统一走 keyword 过滤与 flow 分类计数（沿袭自抽屉版，勿拆出裸渲染）。
    标题只写中文名：卡片右侧已单独渲染英文标识，标题再带一遍就成了「render render」。 */
const FLOW_EXTRAS: PromptRoleMeta[] = [
  { id: 'render', label: '可见性', hint: '字段是否对外可见：visible 表示出现在对外交付，hidden 表示仅内部流转' },
  { id: 'handoff', label: '移交', hint: '字段产完后交给谁：可交给下一阶段（如 path），或指定 Agent / Skill。留空则不转交' },
  { id: 'internal', label: '内部标记', hint: '仅供平台内部与界面控制使用，不进业务状态的字段标记' },
  { id: 'accumulate', label: '累积', hint: '值会累积进学习者状态（画像 / 上下文），供后续阶段持续使用' },
]

const keyword = ref('')
const category = ref<CategoryId>('all')
const loaded = ref(false)
/** 加载失败原因（非空 = 错误条 + 重试，正文整块不渲染） */
const loadError = ref('')

const promptRoles = ref<PromptRoleMeta[]>([])
/* 完成度/语义初始为空：接口失败时不回退到前端另一套叫法，
   失败就显示失败——半套数据照常渲染正是「没加载出来」被读成「没有这个词条」的来源 */
const completionStates = ref<CompletionMeta[]>([])
const semantics = ref<SemanticsMeta[]>([])
const stages = ref<StageMeta[]>([])
const terms = ref<GlossaryTerm[]>([])
const docs = ref<Array<{ title: string; path: string; desc: string }>>([])

const CATEGORY_SECTIONS = [
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康中心术语' },
] as const

type CategoryId = 'all' | 'flow' | 'status' | 'semantics' | 'stage' | 'concept' | 'health' | 'docs'

/** 分类与正文分组同名同序：下拉选到哪个，正文就出现那个标题，
    不再出现「角色流转」筛「角色与流转」这类两套叫法。
    「状态」只覆盖完成度五档（健康区三分语义单独一类），两类条数相加才对得上「全部」。 */
const categories: Array<{ id: CategoryId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'flow', label: '角色与流转' },
  { id: 'status', label: '完成度五档' },
  { id: 'semantics', label: '健康区三分语义' },
  { id: 'stage', label: '五个阶段' },
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康中心术语' },
  { id: 'docs', label: '文档链接' },
]
/** 目录只列分组（「全部」是视图，不是分组） */
const GROUPS = categories.filter((c) => c.id !== 'all')

const kwLower = computed(() => keyword.value.trim().toLowerCase())
/** 搜索态：分区隐藏、命中行、分类数字是否显示都由它决定 */
const searching = computed(() => !!kwLower.value)

/** 分类维度（2026-10-27 统一）：计数进 option 文案，不再由一排 chip 承载。 */
const categorySelect = computed<CategoryId>({
  get: () => category.value,
  set: (v) => { category.value = v },
})
const categorySelectOptions = computed(() =>
  categories.map((c) => ({
    value: c.id,
    // 搜索时整组隐去数字：那会是命中数，「全部 (1)」会被读成整库只剩一条
    label: searching.value ? c.label : `${c.label}（${countOf(c.id)}）`,
  }))
)

function showCategory(id: string) {
  // 全部视图 = 所有分区；单分类 = 只留命中那一格
  return category.value === 'all' || category.value === id
}

/** 角色与流转的完整口径：接口动态词条 + 4 条固有语义 */
const flowRoles = computed<PromptRoleMeta[]>(() => [...promptRoles.value, ...FLOW_EXTRAS])

/** 健康中心术语里与「健康区三分语义」同名的条目（override-record）只保留语义卡：
    同一条词条在同一页出现两张，一张有中文名一张没有，描述措辞也会漂成两套 */
function categoryTerms(id: 'concept' | 'health') {
  return terms.value.filter((t) =>
    t.category === id && !(id === 'health' && semantics.value.some((s) => s.id === t.term)))
}

function termsOf(id: 'concept' | 'health') {
  const kw = kwLower.value
  return categoryTerms(id).filter((t) => !kw || t.term.toLowerCase().includes(kw) || t.def.toLowerCase().includes(kw))
}

/** 各分类的词条总数（不随搜索变化）：数字是词条库规模，
    每个分类只渲染自己的分组，所以下拉数字与正文卡片数一一对应 */
function countOf(id: CategoryId): number {
  if (id === 'all') return GROUPS.reduce((n, c) => n + countOf(c.id), 0)
  if (id === 'flow') return flowRoles.value.length
  if (id === 'status') return completionStates.value.length
  if (id === 'semantics') return semantics.value.length
  if (id === 'stage') return stages.value.length
  if (id === 'docs') return docs.value.length
  return categoryTerms(id).length
}

/* 目录只列真的有词条的分组：0 条的分组正文里不渲染（或 v-show 隐藏），
   点进去 scrollIntoView 落在 display:none 的元素上等于「点了没反应」。 */
const tocGroups = computed(() => GROUPS.filter((g) => countOf(g.id) > 0))

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

/** 当前视图真正会渲染的卡片数（分类 + 搜索 + 空数据一起算），为 0 时才出空态 */
const visibleCount = computed(() =>
  (showCategory('flow') ? filteredRoles.value.length : 0)
  + (showCategory('status') ? filteredCompletion.value.length : 0)
  + (showCategory('semantics') ? filteredSemantics.value.length : 0)
  + (showCategory('stage') ? filteredStages.value.length : 0)
  + (showCategory('concept') ? termsOf('concept').length : 0)
  + (showCategory('health') ? termsOf('health').length : 0)
  + (showCategory('docs') ? filteredDocs.value.length : 0))

/** 搜索命中总数（跨分类），不受当前分类筛选影响 */
const hitCount = computed(() =>
  filteredRoles.value.length + filteredCompletion.value.length + filteredSemantics.value.length
  + filteredStages.value.length + termsOf('concept').length + termsOf('health').length
  + filteredDocs.value.length)

/** 搜索命中切分：返回 [{ text, hit }]，模板里渲染成 <mark>。
    不用 v-html——词条内容来自接口，拼 HTML 等于把数据当标记执行 */
function hlSegs(text: string): Array<{ text: string; hit: boolean }> {
  const q = kwLower.value
  if (!q) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const segs: Array<{ text: string; hit: boolean }> = []
  let from = 0
  let at = lower.indexOf(q)
  while (at !== -1) {
    if (at > from) segs.push({ text: text.slice(from, at), hit: false })
    segs.push({ text: text.slice(at, at + q.length), hit: true })
    from = at + q.length
    at = lower.indexOf(q, from)
  }
  if (!segs.length) return [{ text, hit: false }]
  if (from < text.length) segs.push({ text: text.slice(from), hit: false })
  return segs
}

/** 目录跳转：滚到分组标题，并把焦点交给标题（读屏会读出段名；
    点击链接后焦点原本留在目录里，视觉滚过去了、光标还在原地）。
    scrollIntoView 在 jsdom 里没有实现，按能力调用。 */
function jumpTo(id: CategoryId) {
  const el = document.getElementById(`mg-${id}`)
  if (!el) return
  el.querySelector<HTMLElement>('.mg__section-title')?.focus({ preventScroll: true })
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function clearSearch() {
  keyword.value = ''
}

/** 空态「查看全部词条」：关键词与分类一起清掉，确保落地就有词条可读 */
function showAll() {
  keyword.value = ''
  category.value = 'all'
}

async function load() {
  loaded.value = false
  loadError.value = ''
  try {
    const res = await adminGlossaryApi.get()
    const data = res.data?.data
    // 空响应等同失败：全部词条落空会让界面显示成「这个分组暂时没有词条」，把故障说成没数据
    if (!data) {
      loadError.value = '未取到词条数据'
      return
    }
    promptRoles.value = data.promptRoles || []
    completionStates.value = data.completionStates ?? []
    semantics.value = data.semantics ?? []
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
const router = useRouter()

function readCategory(value: unknown): CategoryId {
  return categories.some((c) => c.id === value) ? (value as CategoryId) : 'all'
}

/** URL → 视图：挂载与浏览器前进/后退共用，非法分类回落「全部」 */
function applyQuery() {
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  const cat = readCategory(route.query.cat)
  if (keyword.value !== q) keyword.value = q
  if (category.value !== cat) category.value = cat
}

let queryTimer: ReturnType<typeof setTimeout> | undefined
/** 视图 → URL：键盘输入去抖 250ms；分类切换即时（同一去抖窗口内合并） */
function syncQueryToUrl() {
  if (queryTimer) clearTimeout(queryTimer)
  queryTimer = setTimeout(() => {
    const q = keyword.value.trim()
    const cat = category.value
    const currentQ = typeof route.query.q === 'string' ? route.query.q : ''
    if (q === currentQ && cat === readCategory(route.query.cat)) return
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      if (key !== 'q' && key !== 'cat' && typeof value === 'string') query[key] = value
    }
    if (q) query.q = q
    if (cat !== 'all') query.cat = cat
    void router.replace({ query })
  }, 250)
}

watch([keyword, category], syncQueryToUrl)
watch(() => [route.query.q, route.query.cat], applyQuery)
onBeforeUnmount(() => {
  if (queryTimer) clearTimeout(queryTimer)
})

onMounted(() => {
  /* 深链 ?q=<术语>&cat=<分类>（成就卡术语链接 / 外部分享）：搜索词与分类一起恢复，
     之后两侧双向同步，刷新/复制链接不丢筛选。 */
  applyQuery()
  void load()
})
</script>

<style scoped>
.mg__head { margin-bottom: 14px; }
.mg__title { margin: 0 0 2px; font-size: var(--mk-fs-20); font-weight: 800; color: var(--mk-ink); }

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

/* 错误条：外观由共享 .mk-alert--row 提供，这里只定两行字的排版 */
.mg__error-title { margin: 0 0 2px; font-size: var(--mk-fs-body); font-weight: 800; }
.mg__error-text { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; }

/* 分组目录：七个分组平铺时给入口，每条带该组条数 */
.mg__toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
.mg__toc-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  text-decoration: none;
}
.mg__toc-item:hover { background: var(--mk-surface-2); color: var(--mk-ink); }
.mg__toc-count { color: var(--mk-faint); font-variant-numeric: tabular-nums; }

.mg__result-line { margin: 0 0 14px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }

/* scroll-margin 让目录跳转后的标题不被吸顶工具条压住 */
.mg__section { margin: 0 0 26px; scroll-margin-top: 72px; }
/* 分组标题是整页的导航层：与卡片正文同号同灰会看不出层级，也不好扫读。
   高一个字号档（emphasis）+ 800 权，段头到卡栅格 12px。 */
.mg__section-title {
  margin: 0 0 12px;
  font-size: var(--mk-fs-emphasis);
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--mk-ink);
}
/* 目录跳转后焦点落到标题：键盘用户的可见落点（鼠标点击不画环） */
.mg__section-title:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 4px; }
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
/* 标题里包一层：命中高亮把文字切成多段时，各段仍是同一个 flex 项，不会被父级 gap 拉开 */
.mg__term-text { min-width: 0; }
.mg__term-en { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.mg__term-def { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; overflow-wrap: anywhere; }
/* 出处 chip 在浅蓝底上：--mk-blue 只有 4.39:1，改 accent-deep（亮色 5.68 / 暗色自动翻转） */
.mg__term-where { font-style: normal; color: var(--mk-accent-deep); }
/* 命中高亮：只加底色不改字号，命中词在标题与描述里都看得出位置 */
.mg__hl { background: var(--mk-amber-bg); color: inherit; border-radius: var(--mk-radius-xs); }
/* 空态里的动作并排（MkEmptyState 的默认插槽排在说明之后） */
.mg__empty-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

@media (min-width: 2000px) {
  .mg__title { font-size: var(--mk-fs-emphasis); }
  .mg__grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
}
</style>
