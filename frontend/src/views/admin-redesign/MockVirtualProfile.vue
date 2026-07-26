<template>
  <div v-if="d" class="mk-page vp">
    <header class="vp-top">
      <button type="button" class="vp-back" @click="closeSubPage">← 返回列表</button>
      <div class="vp-top__meta">
        <h2 class="vp-top__name">{{ d.name }}</h2>
        <span v-if="d.archetype" class="mk-badge mk-badge--info">{{ d.archetype }}</span>
        <button v-if="isLive" type="button" class="mk-link" @click="editOpen = true">编辑画像</button>
      </div>
    </header>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="vp-grid">
      <!-- 左：身份与故事 -->
      <div class="vp-col">
        <section class="mk-card vp-hero">
          <div class="vp-hero__body">
            <p class="vp-hero__story">{{ d.story || '暂无人物背景' }}</p>
            <div v-if="d.traits?.length" class="vp-traits">
              <span v-for="t in d.traits" :key="t" class="vp-trait">{{ t }}</span>
            </div>
            <div class="vp-goal">
              <span>长期倾向（可选）</span>
              <strong>{{ d.goal || '由故事产生当次学习需求' }}</strong>
            </div>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">画像字段</h3>
          </div>
          <div class="vp-profile">
            <div v-for="p in d.aiProfile" :key="p.label" class="vp-profile__row">
              <span>{{ p.label }}</span>
              <strong>{{ p.value }}</strong>
            </div>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">故事池 · {{ displayStories.length }}</h3>
            <button
              v-if="isLive"
              type="button"
              class="mk-status__action"
              :class="{ 'mk-status__action--primary': !displayStories.length }"
              :disabled="storyBusy"
              @click="generateStory"
            >
              {{ storyBusy ? '生成中…' : displayStories.length ? '再生成一条' : '生成第一条故事' }}
            </button>
          </div>
          <p v-if="isLive && !displayStories.length" class="vp-next">
            先生成故事。每个故事产生一次学习需求，对应平台上的一条 Path。
          </p>
          <p v-else class="vp-next">
            一人多故事；选中故事后运行，会走 Goal → Path → Learn。平台视角下，该故事对应一套学习任务（一条 Path）。
          </p>
          <div v-if="displayStories.length" class="vp-stories">
            <div
              v-for="(s, i) in displayStories"
              :key="s.id || i"
              class="vp-story-item"
              :class="{ 'is-selected': selectedStoryId === (s.id || String(i)) }"
              @click="selectStory(s, i)"
            >
              <div class="vp-story-item__main">
                <strong>{{ s.title }}</strong>
                <span>{{ s.outline }}</span>
                <div class="vp-story-item__meta">
                  <span v-if="s.pathId" class="vp-chip vp-chip--path">Path 已生成</span>
                  <span v-else class="vp-chip">尚无 Path</span>
                  <span class="vp-chip">运行 {{ s.runCount || 0 }}</span>
                </div>
                <details v-if="hasAdvancedFields(s)" class="vp-story-item__advanced" @click.stop>
                  <summary>高级诊断</summary>
                  <div class="vp-adv-body">
                    <div v-if="getHiddenDetails(s).length" class="vp-adv-row">
                      <span class="vp-adv-row__label">隐藏细节</span>
                      <ul>
                        <li v-for="(item, didx) in getHiddenDetails(s)" :key="`hd-${didx}`">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="getBehaviorHooks(s).length" class="vp-adv-row">
                      <span class="vp-adv-row__label">行为钩子</span>
                      <ul>
                        <li v-for="(item, hidx) in getBehaviorHooks(s)" :key="`bh-${hidx}`">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="getMisdiagnosis(s)" class="vp-adv-row vp-adv-row--text">
                      <span class="vp-adv-row__label">误诊假设</span>
                      <p>{{ getMisdiagnosis(s) }}</p>
                    </div>
                    <div v-if="getGoalSeed(s)" class="vp-adv-row vp-adv-row--object">
                      <span class="vp-adv-row__label">目标种子</span>
                      <pre>{{ JSON.stringify(getGoalSeed(s), null, 2) }}</pre>
                    </div>
                    <div v-if="getDisclosurePlan(s)" class="vp-adv-row vp-adv-row--object">
                      <span class="vp-adv-row__label">披露计划</span>
                      <pre>{{ JSON.stringify(getDisclosurePlan(s), null, 2) }}</pre>
                    </div>
                  </div>
                </details>
              </div>
              <div class="vp-story-item__side">
                <span class="mk-badge" :class="s.status === 'ready' ? 'mk-badge--ok' : 'mk-badge--muted'">
                  {{ selectedStoryId === (s.id || String(i)) ? '已选' : s.status === 'ready' ? '就绪' : s.status }}
                </span>
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-link"
                  :disabled="running"
                  @click.stop="runStory(s, i)"
                >
                  按此故事运行
                </button>
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-link mk-link--danger"
                  :disabled="storyBusy"
                  @click.stop="removeStory(i)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <p v-else class="vp-none">还没有故事。</p>
        </section>
      </div>

      <!-- 右：运行与工具 -->
      <div class="vp-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">
              运行记录
              <span v-if="selectedStoryTitle" class="vp-run-scope">· {{ selectedStoryTitle }}</span>
            </h3>
            <button
              type="button"
              class="mk-status__action mk-status__action--primary"
              :disabled="running || (isLive && !selectedStoryId && displayStories.length !== 1)"
              @click="runOnce"
            >
              {{ running ? '启动中…' : selectedStoryTitle ? '按选中故事运行' : '运行一轮' }}
            </button>
          </div>
          <p v-if="isLive && displayStories.length > 1 && !selectedStoryId" class="vp-next">
            请先在左侧选中一个故事；每个故事对应一套学习任务（Path）。
          </p>
          <div class="vp-runs">
            <div v-for="(r, i) in scopedRuns" :key="r.sessionId || i" class="vp-run">
              <span class="vp-run__dot" :class="`is-${r.tone}`"></span>
              <div class="vp-run__main">
                <strong>{{ formatRunStage(r.stage) }}</strong>
                <span>
                  {{ formatRunResult(r.result) }}
                  <template v-if="r.storyTitle"> · {{ r.storyTitle }}</template>
                  <template v-if="r.pathId"> · Path</template>
                </span>
              </div>
              <span class="vp-run__time">{{ r.time }}</span>
              <div v-if="isLive && r.sessionId" class="vp-run__ops">
                <button type="button" class="mk-link" @click="openSubPage('session', r.sessionId)">控制台</button>
                <button type="button" class="mk-link mk-link--danger" :disabled="sessionBusy" @click="removeSession(r.sessionId)">删除</button>
              </div>
            </div>
            <p v-if="!scopedRuns.length" class="vp-none">
              {{ selectedStoryTitle ? '这个故事还没有运行记录' : '还没有运行记录' }}
            </p>
          </div>
        </section>

        <section v-if="isLive" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">前台投影</h3>
          </div>
          <div class="vp-tools">
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('dashboard')">
              {{ projecting ? '生成中…' : '投影首页' }}
            </button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('goal')">Goal</button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('paths')">路径</button>
            <button type="button" class="vp-tool" :disabled="projecting" @click="openProjection('state')">状态</button>
            <button type="button" class="vp-tool vp-tool--primary" @click="quickLearnOpen = true">账号自动学习</button>
          </div>
          <p class="vp-tools__hint">用该虚拟身份打开前台页面验收。</p>
        </section>

        <section class="vp-preview">
          <h4>链路说明</h4>
          <p>
            一个虚拟人对应多个故事；每个故事产生学习需求后与平台交互，对应一条 Path（一套学习任务）。
            链路：人设 → 选故事 → Goal / Path / Learn。数据写在绑定账号上，前台投影验收。
            「账号自动学习」是账号已有 Path 后，跳过黑盒模拟直接上课的快捷支路。
          </p>
        </section>
      </div>
    </div>

    <QuickLearnPanel
      v-if="isLive && subPage?.id"
      v-model:visible="quickLearnOpen"
      :profile-id="subPage.id"
    />

    <!-- 编辑画像 -->
    <div v-if="editOpen" class="mk-modal" @mousedown.self="editOpen = false">
      <div class="mk-modal__panel" role="dialog" aria-label="编辑画像">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编辑画像</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="editOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field">
            <span class="mk-field__label">名称</span>
            <input v-model="editForm.name" class="mk-field__input" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">长期倾向（可选，非故事目标）</span>
            <input v-model="editForm.goal" class="mk-field__input" placeholder="可留空；当次需求来自故事" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">知识水平</span>
            <select v-model="editForm.level" class="mk-field__select">
              <option value="beginner">零基础</option>
              <option value="elementary">入门</option>
              <option value="intermediate">中级</option>
              <option value="advanced">进阶</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">故事 / 备注</span>
            <textarea v-model="editForm.notes" class="mk-field__textarea" rows="4"></textarea>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="editOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="saveProfile">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="mk-page">
    <button type="button" class="vp-back" @click="closeSubPage">← 虚拟学习者</button>
    <div class="mk-empty">
      <strong>{{ isLive ? '加载中…' : '该样本暂无更多演示数据' }}</strong>
      <span>{{ isLive ? '正在拉取真实画像' : '演示详情仅覆盖部分样本。' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { subPage, closeSubPage, virtualProfiles, dataSource, openSubPage } from './mockStore'
import { liveGetVirtualDetail, liveVirtuals, timeAgo, errMsg } from './mockLive'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'
import QuickLearnPanel from '@/views/admin/components/virtual/QuickLearnPanel.vue'

interface RunItem {
  time: string
  stage: string
  result: string
  tone: 'ok' | 'warn' | 'bad'
  sessionId?: string
  storyId?: string | null
  storyTitle?: string | null
  pathId?: string | null
}

interface Detail {
  name: string
  archetype: string
  story: string
  goal: string
  level: string
  notes: string
  traits: string[]
  runs: RunItem[]
  aiProfile: { label: string; value: string }[]
}

interface StoryItem {
  id?: string
  index?: number
  title: string
  outline: string
  status: string
  runCount?: number
  pathId?: string | null
  pathCount?: number
  // 来自 scenario-designer 的隐藏字段（高级诊断）——保留原始对象用于折叠展示
  hiddenDetails?: string[]
  behaviorHooks?: string[]
  misdiagnosis?: string
  goalSeed?: Record<string, unknown> | null
  disclosurePlan?: Record<string, unknown> | null
}

const isLive = computed(() => dataSource.value === 'live')
const liveDetail = ref<Detail | null>(null)
const stories = ref<StoryItem[]>([])
const selectedStoryId = ref<string | null>(null)

/* demo 模式的故事池（按样本给出有差异的演示故事） */
const DEMO_STORIES: Record<string, StoryItem[]> = {
  'vl-001': [
    { id: 'demo-s1', index: 0, title: '周五下午的老板突袭', outline: '17:40 老板临时要周报汇总，她只有 40 分钟做完 3 小时的活', status: 'ready', runCount: 2, pathId: 'demo-p1' },
    { id: 'demo-s2', index: 1, title: '模板救星', outline: '她找到去年的周报模板，但数据源格式变了，VLOOKUP 全报错', status: 'ready', runCount: 1, pathId: null },
    { id: 'demo-s3', index: 2, title: '最后一次手工周报', outline: '同事告诉她"其实可以自动化"，她决定这次真的学会', status: 'draft', runCount: 0, pathId: null }
  ],
  'vl-002': [
    { id: 'demo-s4', index: 0, title: '十年教案的思维惯性', outline: '她把学习路径排成"学期课程表"，两周还没写第一行代码', status: 'ready', runCount: 1, pathId: 'demo-p2' },
    { id: 'demo-s5', index: 1, title: '被推着的第一个项目', outline: '里程碑倒逼：本周必须交出一份真实数据分析，哪怕很糙', status: 'ready', runCount: 0, pathId: null }
  ],
  'vl-003': [
    { id: 'demo-s6', index: 0, title: '截稿日前 30 天', outline: '导师下了最后通牒，她却在擦桌子、整理文献、做一切与论文无关的事', status: 'ready', runCount: 1, pathId: null },
    { id: 'demo-s7', index: 1, title: '周末爆发户', outline: 'weekday 低效、周末爆发——系统需要适应她的节奏而不是纠正', status: 'draft', runCount: 0, pathId: null }
  ]
}
const displayStories = computed<StoryItem[]>(() => {
  if (isLive.value) return stories.value
  return DEMO_STORIES[subPage.value?.id || ''] || DEMO_STORIES['vl-001']
})

const selectedStory = computed(() => {
  const list = displayStories.value
  if (!list.length) return null
  if (selectedStoryId.value) {
    return list.find((s, i) => (s.id || String(i)) === selectedStoryId.value) || null
  }
  return list.length === 1 ? list[0] : null
})
const selectedStoryTitle = computed(() => selectedStory.value?.title || '')

function selectStory(s: StoryItem, index: number) {
  selectedStoryId.value = s.id || String(index)
}

function storyPayload(s?: StoryItem | null, index?: number) {
  const target = s || selectedStory.value
  if (!target) return {}
  if (target.id) return { storyId: target.id }
  const idx = typeof index === 'number' ? index : target.index
  if (typeof idx === 'number') return { storyIndex: idx }
  return {}
}

// ===== 故事高级诊断字段（来自 scenario-designer 的 5 个 hidden fields） =====
const getHiddenDetails = (s: StoryItem): string[] =>
  Array.isArray(s.hiddenDetails) ? s.hiddenDetails : []
const getBehaviorHooks = (s: StoryItem): string[] =>
  Array.isArray(s.behaviorHooks) ? s.behaviorHooks : []
const getMisdiagnosis = (s: StoryItem): string =>
  typeof s.misdiagnosis === 'string' ? s.misdiagnosis : ''
const getGoalSeed = (s: StoryItem): Record<string, unknown> | null =>
  s.goalSeed && typeof s.goalSeed === 'object' ? s.goalSeed : null
const getDisclosurePlan = (s: StoryItem): Record<string, unknown> | null =>
  s.disclosurePlan && typeof s.disclosurePlan === 'object' ? s.disclosurePlan : null
const hasAdvancedFields = (s: StoryItem) =>
  getHiddenDetails(s).length > 0
  || getBehaviorHooks(s).length > 0
  || !!getMisdiagnosis(s)
  || !!getGoalSeed(s)
  || !!getDisclosurePlan(s)
const running = ref(false)
const saving = ref(false)
const storyBusy = ref(false)
const sessionBusy = ref(false)
const projecting = ref(false)
const quickLearnOpen = ref(false)
const editOpen = ref(false)
const editForm = ref({ name: '', goal: '', level: 'beginner', notes: '' })
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

function mapStoryItem(s: Record<string, unknown>, index: number): StoryItem {
  const stats = (s.stats || {}) as Record<string, unknown>
  const latestRun = (s.latestRun || {}) as Record<string, unknown>
  const bindings = (latestRun.bindings || {}) as Record<string, unknown>
  const pathId = bindings.learningPathId ? String(bindings.learningPathId) : null
  return {
    id: String(s.storyId || s.id || s.key || `story-${index}`),
    index: typeof s.index === 'number' ? Number(s.index) : index,
    title: String(s.storyTitle || s.title || `故事 ${index + 1}`),
    outline: String(s.storyOutline || s.outline || s.storyTriggerEvent || s.triggerEvent || ''),
    status: String(s.status || 'draft'),
    runCount: Number(stats.totalRuns ?? 0),
    pathCount: Number(stats.pathCount ?? (pathId ? 1 : 0)),
    pathId,
    hiddenDetails: Array.isArray(s.hiddenDetails)
      ? s.hiddenDetails.map((item) => String(item)).filter(Boolean) : undefined,
    behaviorHooks: Array.isArray(s.behaviorHooks)
      ? s.behaviorHooks.map((item) => String(item)).filter(Boolean) : undefined,
    misdiagnosis: typeof s.misdiagnosis === 'string' && s.misdiagnosis ? s.misdiagnosis : undefined,
    goalSeed: s.goalSeed && typeof s.goalSeed === 'object'
      ? s.goalSeed as Record<string, unknown> : undefined,
    disclosurePlan: s.disclosurePlan && typeof s.disclosurePlan === 'object'
      ? s.disclosurePlan as Record<string, unknown> : undefined
  }
}

function parseSessionStory(session: Record<string, unknown>) {
  const direct = session.storyContext as Record<string, unknown> | undefined
  if (direct && typeof direct === 'object') {
    return {
      storyId: direct.storyId ? String(direct.storyId) : null,
      title: direct.title ? String(direct.title) : null
    }
  }
  try {
    const stage = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults)
      : (session.stageResults || {})
    const story = (stage as Record<string, unknown>)?.story as Record<string, unknown> | undefined
    if (!story || typeof story !== 'object') return { storyId: null, title: null }
    return {
      storyId: story.storyId ? String(story.storyId) : null,
      title: story.title ? String(story.title) : null
    }
  } catch {
    return { storyId: null, title: null }
  }
}

async function loadDetail(id: string) {
  liveDetail.value = null
  stories.value = []
  try {
    const [raw, storiesRes] = await Promise.all([
      liveGetVirtualDetail(id) as Promise<Record<string, unknown>>,
      adminVirtualLearnersApi.getVirtualLearnerStories(id).catch(() => null)
    ])
    const p = (raw.profile as Record<string, unknown>) || {}
    const sessions = (raw.sessions || raw.virtual_sessions || []) as Record<string, unknown>[]
    const traitsRaw = (raw.personalityTraits || p.traits || {}) as Record<string, unknown>

    const storiesBody = storiesRes?.data?.data ?? storiesRes?.data ?? null
    const apiStories = Array.isArray(storiesBody?.stories) ? storiesBody.stories as Record<string, unknown>[] : null
    if (apiStories) {
      stories.value = apiStories.map((s, i) => mapStoryItem(s, i))
    } else {
      const storyPool = (p.storyPool || raw.storyPool || raw.stories || []) as Record<string, unknown>[]
      stories.value = storyPool.map((s, i) => mapStoryItem(s, i))
    }

    if (stories.value.length === 1) {
      selectedStoryId.value = stories.value[0].id || '0'
    } else if (selectedStoryId.value && !stories.value.some((s, i) => (s.id || String(i)) === selectedStoryId.value)) {
      selectedStoryId.value = null
    }

    liveDetail.value = {
      name: String(p.name || raw.userName || id),
      archetype: String(p.archetype || p.corePersonality || '自定义样本'),
      story: String(p.background || raw.notes || '（未填写故事）'),
      goal: String(raw.learningGoal || '未设置目标'),
      level: String(raw.knowledgeLevel || 'beginner'),
      notes: String(raw.notes || ''),
      traits: Object.entries(traitsRaw).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`),
      runs: sessions.slice(0, 12).map((s) => {
        const storyMeta = parseSessionStory(s)
        const pathId = s.learningPathId ? String(s.learningPathId) : null
        return {
          time: timeAgo(String(s.createdAt || s.startedAt || '')),
          stage: String(s.currentStage || s.stage || s.phase || 'goal'),
          result: String(s.status || s.result || 'created'),
          tone: (s.status === 'error' || s.status === 'failed' || s.status === 'timeout'
            ? 'bad'
            : s.status === 'completed' || s.status === 'succeeded'
              ? 'ok'
              : 'warn') as RunItem['tone'],
          sessionId: String(s.id || s.sessionId || ''),
          storyId: storyMeta.storyId,
          storyTitle: storyMeta.title,
          pathId
        }
      }),
      aiProfile: [
        { label: '知识水平', value: String(raw.knowledgeLevel || '—') },
        { label: '模拟模式', value: String(raw.simulationMode || '—') },
        { label: '性格基线', value: String(p.emotionalBaseline || p.corePersonality || '—') }
      ]
    }
  } catch {
    const base = liveVirtuals.value.find((v) => v.id === id)
    if (base) {
      liveDetail.value = {
        name: base.name,
        archetype: '自定义样本',
        story: base.story || '（未填写故事）',
        goal: base.goal,
        level: base.level || 'beginner',
        notes: base.story,
        traits: [],
        runs: [],
        aiProfile: [{ label: '知识水平', value: base.level || '—' }]
      }
    }
  }
}

watch(
  () => [subPage.value?.id, isLive.value] as const,
  async ([id, live]) => {
    if (id && live) await loadDetail(id)
  },
  { immediate: true }
)

/* 编辑画像 */
function openEdit() {
  if (!liveDetail.value) return
  editForm.value = {
    name: liveDetail.value.name,
    goal: liveDetail.value.goal,
    level: liveDetail.value.level,
    notes: liveDetail.value.notes || liveDetail.value.story
  }
  editOpen.value = true
}

async function saveProfile() {
  const id = subPage.value?.id
  if (!id || saving.value) return
  saving.value = true
  try {
    await adminVirtualLearnersApi.updateVirtualLearner(id, {
      name: editForm.value.name.trim(),
      learningGoal: editForm.value.goal.trim(),
      knowledgeLevel: editForm.value.level,
      notes: editForm.value.notes.trim()
    })
    await loadDetail(id)
    editOpen.value = false
    showToast('画像已保存（真实写入）')
  } catch (e) {
    showToast(`保存失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    saving.value = false
  }
}
watch(editOpen, (v) => v && openEdit())

/* 故事池 */
async function generateStory() {
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.draftVirtualLearnerStories(id)
    await loadDetail(id)
    showToast('新故事已生成')
  } catch (e) {
    const msg = errMsg(e)
    // 画像字段不完整（旧样本缺 learningStyle 等）：先 AI 补全画像再重试一次
    if (msg.includes('personaSeed') || msg.includes('SCENARIO_OUTPUT_INVALID')) {
      try {
        showToast('画像不完整，正在 AI 补全后重试…', 'mk-toast--info')
        const base = liveVirtuals.value.find((v) => v.id === id)
        const g = await adminVirtualLearnersApi.generatePersona({
          existingPersonaSeed: {
            name: base?.name,
            learningGoal: base?.goal,
            notes: base?.story
          }
        })
        const d = g.data?.data ?? g.data ?? {}
        const seed = (d.personaSeed || d) as Record<string, unknown>
        await adminVirtualLearnersApi.updateVirtualLearner(id, { profile: { ...seed } })
        await adminVirtualLearnersApi.draftVirtualLearnerStories(id)
        await loadDetail(id)
        showToast('画像已补全，新故事已生成')
      } catch (e2) {
        showToast(`生成失败：${errMsg(e2)}`, 'mk-toast--bad')
      }
    } else {
      showToast(`生成失败：${msg}`, 'mk-toast--bad')
    }
  } finally {
    storyBusy.value = false
  }
}

async function removeStory(index: number) {
  const id = subPage.value?.id
  if (!id || storyBusy.value) return
  if (!window.confirm(`确认删除第 ${index + 1} 个故事？`)) return
  storyBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteStory(id, index)
    await loadDetail(id)
    showToast('故事已删除')
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    storyBusy.value = false
  }
}

/* 会话：必须绑定故事（一人多故事 → 一故事一 Path） */
async function runStory(story?: StoryItem, index?: number) {
  const id = subPage.value?.id
  if (!id || running.value) return
  if (isLive.value) {
    const target = story || selectedStory.value
    if (!target && displayStories.value.length !== 1) {
      showToast('请先选择一个故事；每个故事对应一套学习任务（Path）', 'mk-toast--bad')
      return
    }
    if (target) selectStory(target, typeof index === 'number' ? index : target.index ?? 0)
  }
  running.value = true
  try {
    if (isLive.value) {
      const payload = storyPayload(story, index)
      const res = await adminVirtualLearnersApi.startVirtualSession(id, payload)
      const session = res.data?.data ?? res.data ?? {}
      const storyLabel = selectedStoryTitle.value || story?.title || '故事'
      showToast(`已按「${storyLabel}」启动：${String(session.id || session.sessionId || '').slice(0, 14)}…`)
      await loadDetail(id)
    } else {
      await new Promise((r) => setTimeout(r, 900))
      showToast('演示运行完成：Goal 对话 8 轮收敛')
    }
  } catch (e) {
    showToast(`启动失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    running.value = false
  }
}

async function runOnce() {
  await runStory()
}

async function removeSession(sessionId: string) {
  if (!sessionId || sessionBusy.value) return
  if (!window.confirm('确认删除该会话？')) return
  sessionBusy.value = true
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId)
    const id = subPage.value?.id
    if (id) await loadDetail(id)
    showToast('会话已删除')
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    sessionBusy.value = false
  }
}

/* 投影到前台（多入口） */
async function openProjection(entry: 'dashboard' | 'goal' | 'paths' | 'state' = 'dashboard') {
  const id = subPage.value?.id
  if (!id || projecting.value) return
  projecting.value = true
  try {
    const res = await adminVirtualLearnersApi.createProjectionToken(id, { scope: 'full' })
    const body = res.data?.data ?? res.data ?? {}
    const token = String(body.token || body.projectionToken || '')
    if (!token) throw new Error('未返回投影 token')
    setProjectionToken(token, { virtualLearnerId: id })
    const href =
      entry === 'goal' ? '/goal-conversation'
        : entry === 'paths' ? '/learning-paths'
          : entry === 'state' ? '/learning-state'
            : '/dashboard'
    window.open(href, '_blank')
    showToast(`已在新窗口打开投影：${href}`)
  } catch (e) {
    showToast(`投影失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    projecting.value = false
  }
}

const d = computed<Detail | undefined>(() => {
  if (isLive.value) return liveDetail.value || undefined
  const demo = virtualProfiles.find((x) => x.id === subPage.value?.id) || virtualProfiles[0]
  return { ...demo, level: 'beginner', notes: '' }
})

const scopedRuns = computed(() => {
  const runs = d.value?.runs || []
  const story = selectedStory.value
  if (!story) return runs
  const sid = story.id
  if (!sid) return runs
  const matched = runs.filter((r) => r.storyId && r.storyId === sid)
  return matched.length ? matched : runs.filter((r) => r.storyTitle === story.title)
})

function formatRunStage(stage: string) {
  const s = String(stage || '').toLowerCase()
  if (s === 'running' || s === 'created' || s === 'completed' || s === 'failed' || s === 'error' || s === 'timeout') {
    // 容错：旧数据若 stage/result 仍反了，按状态词不当作阶段
    return '会话'
  }
  if (s.includes('goal')) return '目标对话'
  if (s.includes('path')) return '路径生成'
  if (s.includes('learn') || s.includes('teach')) return '学习回合'
  if (s.includes('wrap')) return '课后产出'
  if (s.includes('scenario') || s.includes('story')) return '故事'
  return stage || '会话'
}

function formatRunResult(result: string) {
  const r = String(result || '').toLowerCase()
  if (r.includes('goal') && !['running', 'created', 'completed', 'failed', 'error', 'timeout'].includes(r)) {
    return '目标对话'
  }
  if (r === 'running') return '进行中'
  if (r === 'created') return '已创建'
  if (r === 'completed' || r === 'success' || r === 'succeeded') return '已完成'
  if (r === 'failed' || r === 'error') return '失败'
  if (r === 'timeout') return '超时'
  if (r === 'paused') return '已暂停'
  return result || '—'
}
</script>

<style scoped>
.vp {
  gap: 18px;
  padding: 18px 22px 28px;
}
.vp-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.vp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}
.vp-top__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vp-top__name {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.vp-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.9fr);
  gap: 18px;
  align-items: start;
}
.vp-col { display: grid; gap: 16px; min-width: 0; }

.vp-hero__body {
  padding: 18px 20px 20px;
  display: grid;
  gap: 14px;
}
.vp-hero__story {
  margin: 0;
  color: var(--mk-muted);
  font-size: 14px;
  line-height: 1.8;
}
.vp-traits { display: flex; gap: 8px; flex-wrap: wrap; }
.vp-trait {
  padding: 4px 11px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 12px;
  font-weight: 700;
}
.vp-goal {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eef5ff;
}
.vp-goal span { font-size: 11.5px; color: var(--mk-faint); font-weight: 700; }
.vp-goal strong { color: var(--mk-blue); font-size: 14px; line-height: 1.45; }

.vp-profile { display: grid; }
.vp-profile__row {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
  align-items: start;
}
.vp-profile__row:last-child { border-bottom: none; }
.vp-profile__row span { color: var(--mk-faint); padding-top: 1px; }
.vp-profile__row strong { font-weight: 600; line-height: 1.55; word-break: break-word; }

.vp-stories { display: grid; }
.vp-story-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #f0f2f5;
  cursor: pointer;
  transition: background 0.12s ease;
}
.vp-story-item:hover { background: #f7f9fc; }
.vp-story-item.is-selected {
  background: #eef5ff;
  box-shadow: inset 3px 0 0 var(--mk-blue, #3478f6);
}
.vp-story-item:last-child { border-bottom: none; }
.vp-story-item__main { flex: 1; display: grid; gap: 4px; min-width: 0; }
.vp-story-item__main strong { font-size: 13.5px; line-height: 1.4; }
.vp-story-item__main > span {
  font-size: 12.5px;
  color: var(--mk-faint);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.vp-story-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.vp-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted, #5b6577);
  font-size: 11px;
  font-weight: 700;
}
.vp-chip--path {
  background: #e8f7ee;
  color: #1a7f4b;
}
.vp-story-item__side {
  display: grid;
  gap: 6px;
  justify-items: end;
  flex-shrink: 0;
}
.vp-run-scope {
  font-weight: 600;
  color: var(--mk-muted, #5b6577);
  font-size: 12.5px;
}

.vp-runs { display: grid; }
.vp-run {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.vp-run:last-child { border-bottom: none; }
.vp-run__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  grid-row: 1 / span 2;
  align-self: start;
  margin-top: 6px;
}
.vp-run__dot.is-ok { background: var(--mk-green); }
.vp-run__dot.is-warn { background: var(--mk-amber); }
.vp-run__dot.is-bad { background: var(--mk-red); }
.vp-run__main { min-width: 0; display: grid; gap: 2px; }
.vp-run__main strong { font-size: 13.5px; }
.vp-run__main span { font-size: 12px; color: var(--mk-faint); }
.vp-run__time {
  font-size: 12px;
  color: var(--mk-faint);
  white-space: nowrap;
  align-self: start;
  padding-top: 2px;
}
.vp-run__ops {
  grid-column: 2 / -1;
  display: flex;
  gap: 10px;
}
.vp-none { margin: 0; padding: 18px; color: var(--mk-faint); font-size: 13px; }
.vp-next {
  margin: 0 18px 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eef5ff;
  border: 1px solid rgba(52, 120, 246, 0.18);
  color: #1f57cc;
  font-size: 13px;
  line-height: 1.6;
}
.mk-link--danger { color: var(--mk-red, #dc2626); }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }

.vp-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 4px 16px 12px;
}
.vp-tool {
  border: 1px solid var(--mk-line);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
  text-align: center;
}
.vp-tool:hover:not(:disabled) {
  border-color: rgba(52, 120, 246, 0.35);
  color: var(--mk-blue);
  background: #f7faff;
}
.vp-tool:disabled { opacity: 0.55; cursor: default; }
.vp-tool--primary {
  grid-column: 1 / -1;
  background: linear-gradient(135deg, #3478f6, #1f57cc);
  border-color: transparent;
  color: #fff;
}
.vp-tool--primary:hover:not(:disabled) {
  color: #fff;
  background: linear-gradient(135deg, #2f6eef, #1a4fbf);
}
.vp-tools__hint {
  margin: 0 16px 14px;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.5;
}

.vp-preview {
  padding: 16px 18px;
  border: 1px dashed var(--mk-line);
  border-radius: 14px;
  display: grid;
  gap: 8px;
  background: #fafbfd;
}
.vp-preview h4 { margin: 0; font-size: 12.5px; color: var(--mk-muted); }
.vp-preview p { margin: 0; font-size: 12.5px; color: var(--mk-faint); line-height: 1.7; }

@media (max-width: 1100px) {
  .vp-grid { grid-template-columns: 1fr; }
  .vp { padding: 16px; }
}

/* =====故事高级诊断折叠区 ===== */
.vp-story-item__advanced {
  margin-top: 4px;
  font-size: 11px;
}
.vp-story-item__advanced > summary {
  list-style: none;
  cursor: pointer;
  color: var(--mk-faint);
  font-weight: 700;
  padding: 2px 0;
}
.vp-story-item__advanced > summary::-webkit-details-marker { display: none; }
.vp-story-item__advanced > summary::before { content: '▸'; margin-right: 4px; font-size: 10px; }
.vp-story-item__advanced[open] > summary::before { content: '▾'; }

.vp-adv-body {
  padding: 6px 0 2px;
  display: grid;
  gap: 8px;
}
.vp-adv-row {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 8px;
  align-items: start;
  font-size: 11.5px;
  color: var(--mk-muted);
  line-height: 1.5;
}
.vp-adv-row__label { color: var(--mk-faint); font-weight: 700; }
.vp-adv-row ul { margin: 0; padding-left: 16px; color: var(--mk-ink); }
.vp-adv-row--text p { margin: 0; color: var(--mk-ink); }
.vp-adv-row--object pre {
  margin: 0;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid var(--mk-line);
  border-radius: 4px;
  font-size: 10.5px;
  color: var(--mk-ink);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
</style>
