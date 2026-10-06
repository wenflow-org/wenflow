<template>
  <div :class="embedded ? 'vlc-embedded' : 'mk-page'">
    <!-- 页头（mk-pagehead 标准形态）：标题+口径副文+导出+导入。
         2026-10-05 卡库改版（用户「有卡啊得，导入是功能，卡展示也是，方便从卡库选人到虚拟学习者」）：
         页面主体从导入表单换成卡墙——卡=账号拍板不变（导入即建号），卡墙=全部卡的可视清单，
         点卡直达该学习者画像（openSubPage virtual）；导入收进抽屉，仍是本页一等功能。 -->
    <MkPageHead v-if="!embedded" title="学习者卡库" sub="结构化卡：账号 + 档案 + 故事池，导入即用（不经编译链）；点卡直达虚拟学习者">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting" @click="doExport">
          {{ exporting ? '导出中…' : '导出卡库' }}
        </button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="drawerOpen = true">导入卡</button>
      </template>
    </MkPageHead>

    <!-- 卡库总量 KPI（全站家法：label + 28px 值 + hint 一短句口径，长解释收 title） -->
    <section class="mk-kpi-grid" aria-label="卡库总量">
      <MkKpi label="卡总数" :value="summary?.total ?? '—'" :hint="summary ? `预置 ${summary.builtin} · 自建 ${summary.custom}` : '按创建时间倒序'" title="卡库全部卡数（预置 + 自建）；一张卡 = 一个虚拟学习者账号 + 档案 + 故事池" />
      <MkKpi label="预置卡" :value="summary?.builtin ?? '—'" hint="仓库预置随部署同步" title="presetKey 幂等同步的仓库预置角色（presets.yaml），导出不包含" />
      <MkKpi label="自建卡" :value="summary?.custom ?? '—'" hint="导入与 AI 创建" title="卡文档导入与后台/AI 创建的卡；「导出卡库」仅导出这部分" />
    </section>

    <!-- 卡墙：全部卡的可视清单（搜名称/Key/目标/标签/邮箱）；点卡 = 到虚拟学习者 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">卡墙</h3>
          <span class="mk-card__meta" title="点卡直达该学习者的画像页（虚拟学习者）">共 {{ filtered.length }} 张<template v-if="keyword"> · 命中 {{ filtered.length }}/{{ cards.length }}</template></span>
        </div>
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / Key / 目标 / 标签" />
        </div>
      </div>

      <MockSkeletonTable v-if="indexLoading" :cols="4" :rows="6" />
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
        <button type="button" class="mk-btn mk-btn--primary" @click="drawerOpen = true">导入第一张卡</button>
      </MkEmptyState>
      <MkEmptyState
        v-else-if="!filtered.length"
        title="没有命中的卡"
        description="换个关键词试试（名称 / Key / 目标 / 标签 / 邮箱）。"
      />
      <div v-else class="vlc-wall">
        <article
          v-for="c in filtered"
          :key="c.profileId"
          class="vlc-card"
          role="button"
          tabindex="0"
          :title="`${cardName(c)}（${c.cardKey || '无 Key'}）· 点击查看卡详情`"
          @click="openDetail(c)"
          @keydown.enter.prevent="openDetail(c)"
          @keydown.space.prevent="openDetail(c)"
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
    </section>

    <!-- 卡详情抽屉（2026-10-05 改版二，用户「点一个啥也没有，我得看得到信息」）：
         点卡 = 全字段可视（人设键值/故事池/预算/自带资料/来源/账号/标签），
         「到虚拟学习者」动作保留（看运行态时用）。此前点卡裸跳 openSubPage 只改 URL——
         virtual 子页宿主挂在虚拟学习者 scene，卡库 scene 下什么都不渲染 -->
    <Teleport to="body">
      <div v-if="detail" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detail = null"></div>
        <aside class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="卡详情">
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">
                <span class="vlc-avatar vlc-avatar--sm" :class="`vlc-avatar--${vlAvatarIndexOf(detail.name)}`" aria-hidden="true">{{ detail.name.slice(0, 1) }}</span>
                {{ detail.name }}
              </h3>
              <span class="mk-drawer__sub mono">
                {{ detail.cardKey || '（无 cardKey）' }}
                <span class="mk-badge" :class="sourceBadge(detail)">{{ sourceText(detail) }}</span>
              </span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>
          <div class="mk-drawer__body vlc-dbody">
            <!-- 概览事实栅格（mk-facts 家族：标签在上值在下） -->
            <div class="mk-facts">
              <div><span>学习目标</span><strong>{{ detail.goal || '—' }}</strong></div>
              <div><span>知识水平</span><strong>{{ levelText(detail.knowledgeLevel) }}</strong></div>
              <div><span>账号</span><strong class="mono">{{ detail.email || '—' }}</strong></div>
              <div><span>来源</span><strong>
                <template v-if="detail.sourceRef"><a :href="detail.sourceRef" target="_blank" rel="noopener" class="mk-link">{{ detail.sourceRef }}</a></template>
                <template v-else>{{ sourceText(detail) }}</template>
              </strong></div>
            </div>

            <!-- 人设 -->
            <section class="vlc-dsec">
              <h4 class="vlc-dsec__head">人设</h4>
              <p v-if="detail.background" class="vlc-dsec__bg">{{ detail.background }}</p>
              <div v-if="detail.personaFacts.length" class="mk-facts">
                <div v-for="f in detail.personaFacts" :key="f.label">
                  <span>{{ f.label }}</span><strong>{{ f.value }}</strong>
                </div>
              </div>
              <p v-if="!detail.background && !detail.personaFacts.length" class="vlc-dsec__empty">这张卡没有人设字段（可能是批次运行产物，仅有账号与目标）。</p>
            </section>

            <!-- 故事池 -->
            <section class="vlc-dsec">
              <h4 class="vlc-dsec__head">故事池 <span class="vlc-dsec__count">{{ detail.stories.length }} 个</span></h4>
              <article v-for="(s, i) in detail.stories" :key="i" class="vlc-story">
                <div class="vlc-story__title">{{ s.title || `故事 ${i + 1}` }}</div>
                <p v-if="s.opening" class="vlc-story__opening">「{{ s.opening }}」</p>
                <ul v-if="s.followUps.length" class="vlc-story__hooks">
                  <li v-for="(h, hi) in s.followUps" :key="hi">{{ h }}</li>
                </ul>
                <div class="vlc-story__meta">
                  <span v-if="s.domain" class="mk-badge mk-badge--muted">{{ s.domain }}</span>
                  <span v-if="s.intentType" class="mk-badge mk-badge--muted">意图 {{ s.intentType }}</span>
                  <span v-if="s.schoolAnchor" class="mk-badge mk-badge--muted">{{ s.schoolAnchor }}</span>
                  <template v-for="(v, k) in s.budget" :key="k">
                    <span v-if="v != null && v !== ''" class="mk-badge mk-badge--muted">{{ budgetLabel(String(k)) }} {{ v }}</span>
                  </template>
                </div>
              </article>
              <p v-if="!detail.stories.length" class="vlc-dsec__empty">无故事池（该学习者可能是运行产物，无卡式故事）。</p>
            </section>

            <!-- 自带资料 -->
            <section v-if="detail.materials.length" class="vlc-dsec">
              <h4 class="vlc-dsec__head">自带资料 <span class="vlc-dsec__count">{{ detail.materials.length }} 份</span></h4>
              <div class="vlc-dsec__mats">
                <span v-for="m in detail.materials" :key="m.title" class="mk-badge mk-badge--muted" :title="`类型：${m.kind}`">{{ materialIcon(m.kind) }} {{ m.title }}</span>
              </div>
            </section>

            <!-- 标签 + 备注 -->
            <section v-if="detail.tags.length || detail.notes" class="vlc-dsec">
              <h4 class="vlc-dsec__head">标签与备注</h4>
              <div v-if="detail.tags.length" class="vlc-card__tags">
                <span v-for="t in detail.tags" :key="t" class="mk-badge mk-badge--muted">{{ t }}</span>
              </div>
              <p v-if="detail.notes" class="vlc-dsec__bg">{{ detail.notes }}</p>
            </section>
          </div>
          <footer class="mk-drawer__foot">
            <span class="vlc-drawer-note" :title="detail.createdAt ? new Date(detail.createdAt).toLocaleString() : ''">卡 = 一个可直接运行的虚拟学习者</span>
            <button type="button" class="mk-btn mk-btn--primary" @click="goLearner(detail.profileId)">到虚拟学习者 →</button>
          </footer>
        </aside>
      </div>
    </Teleport>

    <!-- 导入抽屉（mk-drawer 体系，wide 档：表单+逐卡报告需要宽度）。
         导入成功后刷新卡墙索引（新卡即刻上墙，按创建时间倒序在最前） -->
    <Teleport to="body">
      <div v-if="drawerOpen" class="mk-drawer">
        <div class="mk-drawer__mask" @click="closeDrawer"></div>
        <aside class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="导入卡文档">
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">导入卡文档</h3>
              <span class="mk-drawer__sub">YAML / JSON 的 <code>{ cards: [...] }</code>；一张卡 = 一个虚拟学习者账号 + 档案 + 故事池</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="closeDrawer">✕</button>
          </header>
          <div class="mk-drawer__body">
            <div class="vlc-body">
              <input ref="fileRef" type="file" accept=".yaml,.yml,.json" class="vlc-file" @change="onFileChange" />
              <div
                class="vlc-drop"
                :class="{ 'is-drag': isDragOver }"
                role="button"
                tabindex="0"
                @click="triggerPick"
                @keydown.enter.prevent="triggerPick"
                @dragenter.prevent="onDragEnter"
                @dragover.prevent="onDragOver"
                @dragleave="onDragLeave"
                @drop.prevent="onDrop"
              >
                <span class="vlc-drop__title">{{ isDragOver ? '松开导入卡文档' : (fileName || '拖入或点击选择 .yaml / .json 卡文档') }}</span>
                <span class="vlc-drop__hint">{{ isDragOver ? '松开后将读取并填入下方文本框' : '也可以直接粘贴到下方文本框' }}</span>
              </div>
              <textarea
                v-model="rawText"
                class="mk-field__textarea vlc-text"
                rows="9"
                spellcheck="false"
                placeholder="cards:&#10;  - cardKey: gaozhong-math-01&#10;    nickname: 想补函数的高一学生&#10;    persona:&#10;      nameHint: 高一学生&#10;      background: …&#10;    story:&#10;      visibleOpening: …&#10;      followUps: [ … ]&#10;    source:&#10;      kind: web   # 或 synthetic&#10;      ref: https://…"
                @input="resetReports"
              ></textarea>
              <div class="vlc-opts">
                <label class="vlc-check">
                  <input v-model="enrich" type="checkbox" />
                  <span>导入时富化（调用 persona-designer 逐卡生成完整认知人设，较慢）</span>
                </label>
                <label class="vlc-check">
                  <input v-model="update" type="checkbox" />
                  <span>覆盖已存在的同 cardKey 卡（默认跳过）</span>
                </label>
              </div>
              <div class="vlc-actions">
                <button type="button" class="mk-btn" :disabled="!hasText || validating || importing" @click="doValidate">
                  {{ validating ? '校验中…' : '校验' }}
                </button>
                <button type="button" class="mk-btn mk-btn--primary" :disabled="!canImport || importing || validating" @click="doImport">
                  {{ importing ? '导入中…' : '导入' }}
                </button>
                <span class="vlc-format">识别格式：{{ formatHint }}</span>
              </div>
            </div>

            <section v-if="report" class="vlc-report">
              <h4 class="vlc-report__title">校验结果 <span class="vlc-report__meta">共 {{ report.summary.total }} · 可导入 {{ report.summary.ok }} · 已存在 {{ report.summary.exists }} · <span :class="{ 'vlc-bad': report.summary.error > 0 }">错误 {{ report.summary.error }}</span></span></h4>
              <div class="mk-table-scroll">
                <table class="mk-table">
                  <thead>
                    <tr><th>卡 Key</th><th>状态</th><th>问题</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in report.reports" :key="(r.cardKey || 'row') + i">
                      <td><span class="vlc-key">{{ r.cardKey || '（无 cardKey）' }}</span></td>
                      <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span></td>
                      <td>
                        <div class="vlc-issues">
                          <span v-for="(e, ei) in r.errors" :key="'e' + ei" class="vlc-issue vlc-issue--err">{{ e }}</span>
                          <span v-for="(w, wi) in r.warnings" :key="'w' + wi" class="vlc-issue vlc-issue--warn">{{ w }}</span>
                          <span v-if="!r.errors.length && !r.warnings.length" class="vlc-issue vlc-issue--ok">通过</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section v-if="importResult" class="vlc-report">
              <h4 class="vlc-report__title">导入结果 <span class="vlc-report__meta">新建 {{ importResult.summary.created }} · 覆盖 {{ importResult.summary.updated }} · 跳过 {{ importResult.summary.skipped }} · <span :class="{ 'vlc-bad': importResult.summary.failed > 0 }">失败 {{ importResult.summary.failed }}</span></span></h4>
              <div class="mk-table-scroll">
                <table class="mk-table">
                  <thead>
                    <tr><th>卡 Key</th><th>动作</th><th>备注</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in importResult.results" :key="(r.cardKey || 'row') + i">
                      <td><span class="vlc-key">{{ r.cardKey || '（无 cardKey）' }}</span></td>
                      <td><span class="mk-badge" :class="actionBadge(r.action)">{{ actionText(r.action) }}</span></td>
                      <td><span class="vlc-reason" :title="r.reason || ''">{{ r.reason || '—' }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <footer class="mk-drawer__foot">
            <span class="vlc-drawer-note">导入成功的卡即刻上墙（新卡在最前）</span>
            <button type="button" class="mk-btn" @click="closeDrawer">关闭</button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { vlAvatarIndexOf } from '@/components/mk/vlAvatar'
import { errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

/** 嵌入模式：作为 tab 渲染时隐藏页面外壳（当前为独立场景，保留以对齐同组页面） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()

type CardFormat = 'yaml' | 'json'
type CardStatus = 'ok' | 'error' | 'exists' | 'warn'
type CardAction = 'created' | 'updated' | 'skipped' | 'failed'

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

interface CardDetail {
  profileId: string
  userId: string
  cardKey: string | null
  name: string
  goal: string
  knowledgeLevel: string
  tags: string[]
  preset: boolean
  sourceKind: string | null
  sourceRef: string | null
  email: string | null
  notes: string | null
  createdAt: string
  personaFacts: Array<{ label: string; value: string }>
  nickname: string | null
  nameHint: string | null
  background: string | null
  stories: Array<{
    title: string | null
    opening: string | null
    followUps: string[]
    domain: string | null
    intentType: string | null
    schoolAnchor: string | null
    budget: Record<string, unknown>
  }>
  materials: Array<{ kind: string; title: string }>
}

interface CardIssueReport {
  cardKey: string | null
  status: CardStatus
  errors: string[]
  warnings: string[]
  existingProfileId?: string
}

interface ValidatePayload {
  reports: CardIssueReport[]
  summary: { total: number; ok: number; exists: number; error: number }
}

interface ImportPayload {
  results: Array<{ cardKey: string | null; action: CardAction; reason?: string }>
  summary: { total: number; created: number; updated: number; skipped: number; failed: number }
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

/** 「到虚拟学习者」：详情抽屉动作——跳虚拟学习者 scene 的画像二级页。
    ①跨 scene 必须 router.push（openSubPage 只切内存 state，子页宿主在虚拟学习者 scene，
    从卡库调只改 URL 不渲染——实测「点一个啥也没有」同源问题）；
    ②id 传 profileId：画像详情接口 findProfileDetail 按 virtual_learner_profiles.id 查
    （VL 列表行 id 同源），传 userId 会 404「画像加载失败」 */
function goLearner(profileId: string) {
  detail.value = null
  void router.push({ path: '/admin/virtual-learners', query: { view: 'virtual', id: profileId } })
}

/* ===== 卡详情抽屉（2026-10-05 改版二，用户「点一个啥也没有，我得看得到信息」）===== */
const detail = ref<CardDetail | null>(null)
async function openDetail(c: CardWallEntry) {
  // 先以墙上面片数据占位（秒开），详情接口回填全字段；失败保留基础字段不弹走
  detail.value = {
    ...c,
    notes: null,
    createdAt: '',
    sourceRef: null,
    personaFacts: [],
    nickname: null,
    nameHint: null,
    background: null,
    stories: [],
    materials: [],
  }
  try {
    const res = await adminVirtualLearnersApi.cardsDetail(c.profileId)
    detail.value = (res.data?.data ?? res.data) as CardDetail
  } catch (e) {
    toast.error(errMsg(e) || '卡详情加载失败')
  }
}

/** 预算字段中文标签 */
function budgetLabel(k: string): string {
  const map: Record<string, string> = { dailyMinutes: '每日', horizonDays: '周期(天)', expectedHours: '预期(时)', weeklyHours: '每周(时)' }
  return map[k] || k
}
/** 资料类型字标（不用 emoji，色块+字标） */
function materialIcon(kind: string): string {
  const map: Record<string, string> = { book: '书', course: '课', syllabus: '纲', note: '记' }
  return map[kind] || '记'
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

/* ===== 导入（原表单整体收进抽屉，逻辑不变）===== */
const drawerOpen = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)
const rawText = ref('')
const fileName = ref('')
const fileFormat = ref<CardFormat | null>(null)
const enrich = ref(false)
const update = ref(false)
const validating = ref(false)
const importing = ref(false)
const exporting = ref(false)
const report = ref<ValidatePayload | null>(null)
const importResult = ref<ImportPayload | null>(null)

const hasText = computed(() => rawText.value.trim().length > 0)

/** 格式识别：文件名后缀优先，其次按内容形态（YAML 是 JSON 超集，默认 yaml 也能吃 JSON） */
const formatHint = computed<CardFormat>(() => {
  if (fileFormat.value) return fileFormat.value
  const t = rawText.value.trim()
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'yaml'
})

const canImport = computed(() => {
  if (!hasText.value) return false
  if (report.value) return report.value.summary.ok + report.value.summary.exists > 0
  return true
})

function statusText(s: CardStatus): string {
  return { ok: '可导入', warn: '可导入·有告警', exists: '已存在', error: '不可导入' }[s]
}
function statusBadge(s: CardStatus): string {
  return { ok: 'mk-badge--ok', warn: 'mk-badge--warn', exists: 'mk-badge--muted', error: 'mk-badge--bad' }[s]
}
function actionText(a: CardAction): string {
  return { created: '新建', updated: '覆盖', skipped: '跳过', failed: '失败' }[a]
}
function actionBadge(a: CardAction): string {
  return { created: 'mk-badge--ok', updated: 'mk-badge--info', skipped: 'mk-badge--muted', failed: 'mk-badge--bad' }[a]
}

function resetReports() {
  report.value = null
  importResult.value = null
}

function closeDrawer() {
  drawerOpen.value = false
}

function triggerPick() {
  fileRef.value?.click()
}

function readFile(file: File) {
  fileName.value = file.name
  fileFormat.value = /\.json$/i.test(file.name) ? 'json' : 'yaml'
  const reader = new FileReader()
  reader.onload = () => {
    rawText.value = String(reader.result || '')
    resetReports()
  }
  reader.onerror = () => toast.error('读取文件失败')
  reader.readAsText(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  input.value = ''
}

/* 拖拽文件悬停高亮（EG12）：:hover 在 HTML5 拖拽循环中不触发，需 dragenter/dragleave
   深度计数切状态类（判例 V2GoalConversation.vue 的 boxDragDepth）。 */
const isDragOver = ref(false)
let dragDepth = 0
function onDragEnter() { dragDepth += 1; isDragOver.value = true }
function onDragOver(e: DragEvent) { e.preventDefault() }
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) isDragOver.value = false
}
function onDrop(e: DragEvent) {
  dragDepth = 0
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

async function doValidate() {
  if (!hasText.value) return
  validating.value = true
  importResult.value = null
  try {
    const res = await adminVirtualLearnersApi.cardsValidate({ content: rawText.value, format: formatHint.value })
    report.value = (res.data?.data ?? res.data) as ValidatePayload
    const s = report.value.summary
    if (s.error > 0) toast.warning(`校验完成：${s.error} 张不可导入，请查看问题列`)
    else toast.success(`校验通过：可导入 ${s.ok} 张`)
  } catch (e) {
    toast.error(errMsg(e) || '校验失败')
  } finally {
    validating.value = false
  }
}

async function doImport() {
  if (!hasText.value) return
  if (!report.value) await doValidate()
  importing.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsImport({
      content: rawText.value,
      format: formatHint.value,
      enrich: enrich.value,
      update: update.value
    })
    importResult.value = (res.data?.data ?? res.data) as ImportPayload
    const s = importResult.value.summary
    if (s.failed > 0) toast.warning(`导入完成：新建 ${s.created} · 失败 ${s.failed}`)
    else toast.success(`导入完成：新建 ${s.created} · 覆盖 ${s.updated} · 跳过 ${s.skipped}`)
    report.value = null
    void loadIndex()
  } catch (e) {
    toast.error(errMsg(e) || '导入失败')
  } finally {
    importing.value = false
  }
}

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

/* ===== 卡详情抽屉（2026-10-05 改版二）===== */
.vlc-dbody { display: grid; gap: 18px; }
.vlc-dsec { display: grid; gap: 8px; }
.vlc-dsec__head { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.vlc-dsec__count { margin-left: 6px; font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-faint); }
.vlc-dsec__bg { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); white-space: pre-wrap; }
.vlc-dsec__empty { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.vlc-dsec__mats { display: flex; flex-wrap: wrap; gap: 4px; }
.vlc-story { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.vlc-story__title { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.vlc-story__opening { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); }
.vlc-story__hooks { margin: 0; padding-left: 18px; display: grid; gap: 2px; }
.vlc-story__hooks li { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
.vlc-story__meta { display: flex; flex-wrap: wrap; gap: 4px; }
/* 抽屉标题内小头像（与卡面同色板，缩尺寸） */
.vlc-avatar--sm { width: 22px; height: 22px; font-size: var(--mk-fs-micro); }
.mk-drawer__sub .mk-badge { margin-left: 6px; }
.vlc-dbody .mono, .mk-drawer__sub.mono { font-family: var(--mk-mono); }

/* ===== 导入抽屉内的表单（原页内表单样式随迁）===== */
.vlc-body {
  display: grid;
  gap: 12px;
}
.vlc-report { margin-top: 16px; }
.vlc-report__title { margin: 0 0 8px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.vlc-report__meta { margin-left: 8px; font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-muted); }
.vlc-drawer-note { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.vlc-file {
  display: none;
}
.vlc-drop {
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: 20px 16px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface-2);
  cursor: pointer;
  text-align: center;
}
.vlc-drop:hover {
  border-color: var(--mk-blue);
}
/* 拖拽悬停高亮（EG12）：可松手视觉指示（实线蓝框 + 淡蓝底 + 文案改「松开导入」） */
.vlc-drop.is-drag {
  border-color: var(--mk-blue);
  border-style: solid;
  background: var(--mk-blue-bg);
}
.vlc-drop__title {
  font-size: var(--mk-fs-body);
  font-weight: 600;
  color: var(--mk-ink);
}
.vlc-drop__hint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.vlc-text {
  width: 100%;
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  resize: vertical;
}
.vlc-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.vlc-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
}
.vlc-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vlc-format {
  margin-left: auto;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
}
.vlc-key {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
}
.vlc-issues {
  display: flex;
  flex-direction: column;
  gap: 2px;
  white-space: normal;
}
.vlc-issue {
  font-size: var(--mk-fs-micro);
  line-height: 1.45;
}
.vlc-issue--err {
  color: var(--mk-red);
}
.vlc-issue--warn {
  color: var(--mk-amber);
}
.vlc-issue--ok {
  color: var(--mk-faint);
}
.vlc-reason {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.vlc-bad {
  color: var(--mk-red);
  font-weight: 700;
}
</style>
