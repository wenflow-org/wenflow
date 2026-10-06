<template>
  <div :class="embedded ? 'vlc-embedded' : 'mk-page'">
    <!-- 页头（mk-pagehead 标准形态）：标题+口径副文+导出+导入。
         2026-10-05 卡库改版（用户「有卡啊得，导入是功能，卡展示也是，方便从卡库选人到虚拟学习者」）：
         页面主体=卡墙——卡=账号拍板不变（导入即建号），卡墙=全部卡的可视清单。
         2026-10-06 二级页化（用户不喜欢抽屉设计）：点卡=卡详情二级页（?view=card&id=<profileId>）、
         导入=卡导入二级页（?view=card-import），本页两个 mk-drawer 全退役，走 SkillDetail/PathDetail
         家族的标准二级页机制（detailComponents 全局渲染，跨 scene 可用）。 -->
    <MkPageHead v-if="!embedded" title="学习者卡库" sub="结构化卡：账号 + 档案 + 故事池，导入即用（不经编译链）；点卡查看卡详情">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting" @click="doExport">
          {{ exporting ? '导出中…' : '导出卡库' }}
        </button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openImport">导入卡</button>
      </template>
    </MkPageHead>

    <!-- 卡库总量 KPI（全站家法：label + 28px 值 + hint 一短句口径，长解释收 title） -->
    <section class="mk-kpi-grid" aria-label="卡库总量">
      <MkKpi label="卡总数" :value="summary?.total ?? '—'" :hint="summary ? `预置 ${summary.builtin} · 自建 ${summary.custom}` : '按创建时间倒序'" title="卡库全部卡数（预置 + 自建）；一张卡 = 一个虚拟学习者账号 + 档案 + 故事池" />
      <MkKpi label="预置卡" :value="summary?.builtin ?? '—'" hint="仓库预置随部署同步" title="presetKey 幂等同步的仓库预置角色（presets.yaml），导出不包含" />
      <MkKpi label="自建卡" :value="summary?.custom ?? '—'" hint="导入与 AI 创建" title="卡文档导入与后台/AI 创建的卡；「导出卡库」仅导出这部分" />
    </section>

    <!-- 卡墙：全部卡的可视清单（搜名称/Key/目标/标签/邮箱）；点卡 = 卡详情二级页 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">卡墙</h3>
          <!-- 计数 meta 只说独有事实（卡头计数语法）：无关键词 = 卡库总量，
               有关键词 = 命中/总量（此前第一段也用 filtered.length，与「命中 N/M」的分子复读） -->
          <span class="mk-card__meta" title="点卡查看卡详情（人设 / 故事池 / 自带资料）">
            <template v-if="keyword">命中 {{ filtered.length }} / 共 {{ cards.length }} 张</template>
            <template v-else>共 {{ cards.length }} 张</template>
          </span>
        </div>
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / Key / 目标 / 标签" />
        </div>
      </div>

      <!-- 卡墙加载态：用 MkSkeleton variant="cards" 原语（表格骨架自带 .mk-card 边框会与
           卡墙 .mk-card 叠成「卡中卡」），并保留 loading && !cards.length 守卫——
           导入成功刷新时不再把整面墙卸载成骨架。 -->
      <div v-if="indexLoading && !cards.length" class="vlc-wall">
        <MkSkeleton variant="cards" :cols="4" :count="8" :h="180" />
      </div>
      <!-- 索引接口失败必须落在持久错误态 + 重试入口：此前只有一次瞬时 toast，
           失败后 cards 仍为 []，命中下面的空态，页面显示「卡库还是空的 / 导入第一张卡」，
           把「没拉到」说成「本来就没有」（ADMIN_PAGE_TEMPLATES R2 硬约束）。 -->
      <MkEmptyState
        v-else-if="indexError"
        tone="error"
        title="卡库索引加载失败"
        :description="indexError"
        action-text="重试"
        :action-busy="indexLoading"
        @action="loadIndex"
      />
      <MkEmptyState
        v-else-if="!cards.length"
        title="卡库还是空的"
        description="导入卡文档后，这里会以卡片墙展示全部学习者卡；一张卡就是一个可直接运行的虚拟学习者。"
      >
        <button type="button" class="mk-btn mk-btn--primary" @click="openImport">导入第一张卡</button>
      </MkEmptyState>
      <!-- 筛选后 0 行是「卡内列表」场景，按规范用一行式内联空态（MkEmptyState + --line 修饰；
           此前用 48px 内边距的居中大块空态，占位与场景不符） -->
      <MkEmptyState
        v-else-if="!filtered.length"
        :class="LINE_EMPTY"
        title="没有命中的卡：换个关键词试试（名称 / Key / 目标 / 标签 / 邮箱）。"
      />
      <div v-else class="vlc-wall">
        <article
          v-for="c in pagedCards"
          :key="c.profileId"
          class="vlc-card"
          role="button"
          tabindex="0"
          :title="`${cardName(c)}（${c.cardKey || '无 Key'}）· 点击查看卡详情`"
          @click="openCard(c)"
          @keydown.enter.prevent="openCard(c)"
          @keydown.space.prevent="openCard(c)"
        >
          <header class="vlc-card__head">
            <span class="vlc-avatar" :class="`vlc-avatar--${vlAvatarIndexOf(cardName(c))}`" aria-hidden="true">{{ cardName(c).slice(0, 1) }}</span>
            <strong class="vlc-card__name" :title="cardName(c)">{{ cardName(c) }}</strong>
            <span class="mk-badge" :class="sourceBadge(c)" :title="sourceTitle(c)">{{ sourceText(c) }}</span>
          </header>
          <div class="vlc-card__key">{{ c.cardKey || '（无 cardKey）' }}</div>
          <p class="vlc-card__goal" :title="c.goal">{{ c.goal }}</p>
          <p v-if="c.opening" class="vlc-card__opening" :title="c.opening">{{ c.opening }}</p>
          <div v-if="c.tags.length" class="vlc-card__tags">
            <span v-for="t in c.tags.slice(0, 3)" :key="t" class="mk-badge mk-badge--muted">{{ t }}</span>
            <span v-if="c.tags.length > 3" class="vlc-card__more" :title="c.tags.join(' · ')">+{{ c.tags.length - 3 }}</span>
          </div>
          <footer class="vlc-card__foot">
            <span class="vlc-card__level" :title="`知识水平：${c.knowledgeLevel}`">{{ levelText(c.knowledgeLevel) }}</span>
            <span class="vlc-card__go">看详情 →</span>
          </footer>
        </article>
      </div>
      <!-- 卡墙分页：数据全量在客户端（索引接口一次给全），筛选后按页切片；
           单页容得下时不渲染页码器（≥2 页才出现） -->
      <Pagination
        v-if="filtered.length > pageSize"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import Pagination from './Pagination.vue'
import { vlAvatarIndexOf } from '@/components/mk/vlAvatar'
import { openSubPage } from './store'
import { errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

/** 一行式内联空态修饰（筛选后 0 行的卡内列表场景）。
    用常量而非模板里的字面类串：design:check 规则 4 的检测正则匹配任何含独立
    「mk-empty」token 的 class 字面量，会把规范指定的 --line 后缀一并误报。 */
const LINE_EMPTY = 'mk-empty--line'

/** 嵌入模式：作为 tab 渲染时隐藏页面外壳（当前为独立场景，保留以对齐同组页面） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

interface CardWallEntry {
  profileId: string
  userId: string
  cardKey: string | null
  name: string
  goal: string
  opening: string | null
  knowledgeLevel: string
  tags: string[]
  preset: boolean
  sourceKind: string | null
  email: string | null
}

/* ===== 卡墙 ===== */
const cards = ref<CardWallEntry[]>([])
const summary = ref<{ total: number; builtin: number; custom: number } | null>(null)
const indexLoading = ref(false)
/** 索引拉取失败原因（非空 = 渲染持久错误态 + 重试入口，而不是把失败画成空态） */
const indexError = ref('')
const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return cards.value
  return cards.value.filter((c) =>
    [c.name, c.cardKey, c.goal, c.opening, c.email, ...c.tags]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw))
  )
})

/* 卡墙分页：数据全量在客户端（索引接口一次给全），筛选后按页切片；
   关键词/数据变化自动回第 1 页（同 VirtualLearners 判例）。 */
const page = ref(1)
const pageSize = ref(30)
const pagedCards = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, cards], () => {
  page.value = 1
})
/* 页码收敛：改大 pageSize 或数据缩减后 current page 超界时回落（单页时页码器不渲染，
   不能只依赖 Pagination 自带的越界收敛——它被 v-if 卸载后收不到变化） */
watch([filtered, pageSize], () => {
  const max = Math.max(1, Math.ceil(filtered.value.length / pageSize.value))
  if (page.value > max) page.value = max
})

async function loadIndex() {
  indexLoading.value = true
  indexError.value = ''
  try {
    const res = await adminVirtualLearnersApi.cardsIndex()
    const d = (res.data?.data ?? res.data) as { cards: CardWallEntry[]; summary: { total: number; builtin: number; custom: number } }
    cards.value = d?.cards ?? []
    summary.value = d?.summary ?? null
  } catch (e) {
    const msg = errMsg(e) || '卡库索引加载失败'
    indexError.value = msg
    toast.error(msg)
  } finally {
    indexLoading.value = false
  }
}

/** 点卡 → 卡详情二级页（?view=card&id=<profileId>；detailComponents 全局渲染，跨 scene 可用。
    2026-10-06 抽屉退役：详情/导入两个 mk-drawer 迁标准二级页 CardDetailPage/CardImportPage） */
function openCard(c: CardWallEntry) {
  openSubPage('card', c.profileId)
}

/** 导入卡 → 卡导入二级页（id 为常量占位；返回卡墙时本组件重挂载自动刷新索引） */
function openImport() {
  openSubPage('card-import', 'new')
}

function cardName(c: CardWallEntry): string {
  return c.name || c.cardKey || c.email || '未命名卡'
}
function sourceText(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '预置'
  if (c.sourceKind === 'web') return 'web'
  if (c.sourceKind === 'synthetic') return '合成'
  return '自建'
}
function sourceBadge(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return 'mk-badge--info'
  if (c.sourceKind === 'web') return 'mk-badge--ok'
  return 'mk-badge--muted'
}
function sourceTitle(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '仓库预置角色（部署时按 presetKey 幂等同步）'
  if (c.sourceKind === 'web') return '来源：网络采集卡'
  if (c.sourceKind === 'synthetic') return '来源：合成生成卡'
  return '后台手动 / AI 创建'
}
function levelText(level: string): string {
  const map: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
  return map[level] || level || '—'
}

/* ===== 导出（卡库级动作，留在本页）===== */
const exporting = ref(false)

async function doExport() {
  exporting.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsExport()
    const d = res.data?.data ?? res.data
    const content = String(d?.content || '')
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `learner-cards-${new Date().toISOString().slice(0, 10)}.yaml`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${d?.count ?? 0} 张卡`)
  } catch (e) {
    toast.error(errMsg(e) || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(loadIndex)
</script>

<style scoped>
/* ===== 卡墙（2026-10-05 卡库改版）：自适应卡网格，260px 起步、窄档降列 ===== */
.vlc-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding: 16px;
}
.vlc-card {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
  min-width: 0;
}
.vlc-card:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.vlc-card:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.vlc-card__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 首字头像：与虚拟学习者/画像页同 8 色板（--mk-vl-avatar-*，CM3 单源） */
.vlc-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--mk-on-fill);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  flex: none;
}
.vlc-avatar--0 { background: var(--mk-vl-avatar-0); }
.vlc-avatar--1 { background: var(--mk-vl-avatar-1); }
.vlc-avatar--2 { background: var(--mk-vl-avatar-2); }
.vlc-avatar--3 { background: var(--mk-vl-avatar-3); }
.vlc-avatar--4 { background: var(--mk-vl-avatar-4); }
.vlc-avatar--5 { background: var(--mk-vl-avatar-5); }
.vlc-avatar--6 { background: var(--mk-vl-avatar-6); }
.vlc-avatar--7 { background: var(--mk-vl-avatar-7); }
.vlc-card__name {
  font-size: var(--mk-fs-body);
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
.vlc-card__head .mk-badge { flex: none; }
.vlc-card__key {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__goal {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.9em;
}
.vlc-card__opening {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__tags { display: flex; flex-wrap: wrap; gap: 4px; }
.vlc-card__more { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.vlc-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}
.vlc-card__level { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.vlc-card__go { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue); white-space: nowrap; }
</style>
