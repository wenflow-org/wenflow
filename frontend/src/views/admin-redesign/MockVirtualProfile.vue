<template>
  <div v-if="d" class="mk-page vp">
    <button type="button" class="vp-back" @click="closeSubPage">← 虚拟学习者</button>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="vp-grid">
      <!-- 左：故事与画像 -->
      <div class="vp-col">
        <section class="mk-card vp-story">
          <div class="mk-card__head">
            <h3 class="mk-card__title">她的故事</h3>
            <div style="display:flex; gap:8px; align-items:center">
              <span class="mk-badge mk-badge--info">{{ d.archetype }}</span>
              <button v-if="isLive" type="button" class="mk-link" @click="editOpen = true">编辑画像</button>
            </div>
          </div>
          <div class="vp-story__body">
            <h4>{{ d.name }}</h4>
            <p>{{ d.story }}</p>
            <div class="vp-traits">
              <span v-for="t in d.traits" :key="t" class="vp-trait">{{ t }}</span>
            </div>
            <div class="vp-goal">
              <span>学习目标</span>
              <strong>{{ d.goal }}</strong>
            </div>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">AI 画像推断</h3>
            <div v-if="isLive" class="vp-proj-actions">
              <button type="button" class="mk-status__action" :disabled="projecting" @click="openProjection('dashboard')">
                {{ projecting ? '生成中…' : '投影首页' }}
              </button>
              <button type="button" class="mk-link" :disabled="projecting" @click="openProjection('goal')">Goal</button>
              <button type="button" class="mk-link" :disabled="projecting" @click="openProjection('paths')">路径</button>
              <button type="button" class="mk-link" :disabled="projecting" @click="openProjection('state')">状态</button>
              <button type="button" class="mk-status__action mk-status__action--primary" @click="quickLearnOpen = true">
                账号自动学习
              </button>
            </div>
          </div>
          <div class="vp-profile">
            <div v-for="p in d.aiProfile" :key="p.label" class="vp-profile__row">
              <span>{{ p.label }}</span>
              <strong>{{ p.value }}</strong>
            </div>
          </div>
        </section>

        <!-- 故事池 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">故事池 · {{ displayStories.length }}</h3>
            <button v-if="isLive" type="button" class="mk-link" :disabled="storyBusy" @click="generateStory">
              {{ storyBusy ? '生成中…' : '生成新故事' }}
            </button>
          </div>
          <div v-if="displayStories.length" class="vp-stories">
            <div v-for="(s, i) in displayStories" :key="i" class="vp-story-item">
              <div class="vp-story-item__main">
                <strong>{{ s.title }}</strong>
                <span>{{ s.outline }}</span>
                <details v-if="hasAdvancedFields(s)" class="vp-story-item__advanced">
                  <summary>高级诊断 · hidden fields</summary>
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
              <span class="mk-badge" :class="s.status === 'ready' ? 'mk-badge--ok' : 'mk-badge--muted'">{{ s.status }}</span>
              <button v-if="isLive" type="button" class="mk-link mk-link--danger" :disabled="storyBusy" @click="removeStory(i)">删除</button>
            </div>
          </div>
          <p v-else class="vp-none">还没有故事{{ isLive ? '，点击「生成新故事」让 AI 为她写一段' : '' }}。</p>
        </section>
      </div>

      <!-- 右：运行记录 -->
      <div class="vp-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">运行记录</h3>
            <button type="button" class="mk-status__action mk-status__action--primary" :disabled="running" @click="runOnce">
              {{ running ? '启动中…' : '运行一轮' }}
            </button>
          </div>
          <div class="vp-runs">
            <div v-for="(r, i) in d.runs" :key="i" class="vp-run">
              <span class="vp-run__dot" :class="`is-${r.tone}`"></span>
              <div class="vp-run__main">
                <strong>{{ r.stage }}</strong>
                <span>{{ r.result }}</span>
              </div>
              <span class="vp-run__time">{{ r.time }}</span>
              <button v-if="isLive && r.sessionId" type="button" class="mk-link" @click="openSubPage('session', r.sessionId)">控制台</button>
              <button v-if="isLive && r.sessionId" type="button" class="mk-link mk-link--danger" :disabled="sessionBusy" @click="removeSession(r.sessionId)">删除</button>
            </div>
            <p v-if="!d.runs.length" class="vp-none">还没有运行记录</p>
          </div>
        </section>

        <section class="vp-preview">
          <h4>黑盒说明</h4>
          <p>虚拟学习者以真实黑盒方式走完整链路：故事 → Goal 对话 → Path 生成 → Learn 回合。运行结果用于评估编排质量，不产生真实用户数据。</p>
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
            <span class="mk-field__label">学习目标</span>
            <input v-model="editForm.goal" class="mk-field__input" />
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
  title: string
  outline: string
  status: string
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

/* demo 模式的故事池（按样本给出有差异的演示故事） */
const DEMO_STORIES: Record<string, StoryItem[]> = {
  'vl-001': [
    { title: '周五下午的老板突袭', outline: '17:40 老板临时要周报汇总，她只有 40 分钟做完 3 小时的活', status: 'ready' },
    { title: '模板救星', outline: '她找到去年的周报模板，但数据源格式变了，VLOOKUP 全报错', status: 'ready' },
    { title: '最后一次手工周报', outline: '同事告诉她"其实可以自动化"，她决定这次真的学会', status: 'draft' }
  ],
  'vl-002': [
    { title: '十年教案的思维惯性', outline: '她把学习路径排成"学期课程表"，两周还没写第一行代码', status: 'ready' },
    { title: '被推着的第一个项目', outline: '里程碑倒逼：本周必须交出一份真实数据分析，哪怕很糙', status: 'ready' }
  ],
  'vl-003': [
    { title: '截稿日前 30 天', outline: '导师下了最后通牒，她却在擦桌子、整理文献、做一切与论文无关的事', status: 'ready' },
    { title: '周末爆发户', outline: 'weekday 低效、周末爆发——系统需要适应她的节奏而不是纠正', status: 'draft' }
  ]
}
const displayStories = computed<StoryItem[]>(() => {
  if (isLive.value) return stories.value
  return DEMO_STORIES[subPage.value?.id || ''] || DEMO_STORIES['vl-001']
})

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

async function loadDetail(id: string) {
  liveDetail.value = null
  stories.value = []
  try {
    const raw = (await liveGetVirtualDetail(id)) as Record<string, unknown>
    const p = (raw.profile as Record<string, unknown>) || {}
    const sessions = (raw.sessions || raw.virtual_sessions || []) as Record<string, unknown>[]
    const traitsRaw = (raw.personalityTraits || p.traits || {}) as Record<string, unknown>
    const storyPool = (p.storyPool || raw.storyPool || raw.stories || []) as Record<string, unknown>[]
    stories.value = storyPool.map((s) => ({
      title: String(s.title || '未命名故事'),
      outline: String(s.storyOutline || s.outline || s.storyTriggerEvent || ''),
      status: String(s.status || 'draft'),
      hiddenDetails: Array.isArray(s.hiddenDetails)
        ? s.hiddenDetails.map((item) => String(item)).filter(Boolean) : undefined,
      behaviorHooks: Array.isArray(s.behaviorHooks)
        ? s.behaviorHooks.map((item) => String(item)).filter(Boolean) : undefined,
      misdiagnosis: typeof s.misdiagnosis === 'string' && s.misdiagnosis ? s.misdiagnosis : undefined,
      goalSeed: s.goalSeed && typeof s.goalSeed === 'object'
        ? s.goalSeed as Record<string, unknown> : undefined,
      disclosurePlan: s.disclosurePlan && typeof s.disclosurePlan === 'object'
        ? s.disclosurePlan as Record<string, unknown> : undefined
    }))
    liveDetail.value = {
      name: String(p.name || raw.userName || id),
      archetype: String(p.archetype || p.corePersonality || '自定义样本'),
      story: String(p.background || raw.notes || '（未填写故事）'),
      goal: String(raw.learningGoal || '未设置目标'),
      level: String(raw.knowledgeLevel || 'beginner'),
      notes: String(raw.notes || ''),
      traits: Object.entries(traitsRaw).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`),
      runs: sessions.slice(0, 8).map((s) => ({
        time: timeAgo(String(s.createdAt || s.startedAt || '')),
        stage: String(s.status || s.stage || '会话'),
        result: String(s.currentStage || s.summary || s.id || ''),
        tone: (s.status === 'error' ? 'bad' : s.status === 'completed' ? 'ok' : 'warn') as RunItem['tone'],
        sessionId: String(s.id || s.sessionId || '')
      })),
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

/* 会话 */
async function runOnce() {
  const id = subPage.value?.id
  if (!id || running.value) return
  running.value = true
  try {
    if (isLive.value) {
      const res = await adminVirtualLearnersApi.startVirtualSession(id)
      const session = res.data?.data ?? res.data ?? {}
      showToast(`会话已启动（真实）：${String(session.id || session.sessionId || '').slice(0, 18)}…`)
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
</script>

<style scoped>
.vp { gap: 14px; }
.vp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  width: fit-content;
}
.vp-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 14px;
  align-items: start;
}
.vp-col { display: grid; gap: 14px; }

.vp-story__body { padding: 16px; display: grid; gap: 12px; }
.vp-story__body h4 { margin: 0; font-size: 17px; }
.vp-story__body p { margin: 0; color: var(--mk-muted); font-size: 13px; line-height: 1.75; }
.vp-traits { display: flex; gap: 6px; flex-wrap: wrap; }
.vp-trait {
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 11.5px;
  font-weight: 700;
}
.vp-goal {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #eef5ff;
}
.vp-goal span { font-size: 11px; color: var(--mk-faint); font-weight: 700; }
.vp-goal strong { color: var(--mk-blue); font-size: 13.5px; }
.vp-proj-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.vp-profile { display: grid; }
.vp-profile__row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.vp-profile__row:last-child { border-bottom: none; }
.vp-profile__row span { color: var(--mk-faint); }
.vp-profile__row strong { font-weight: 600; }

.vp-stories { display: grid; }
.vp-story-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.vp-story-item:last-child { border-bottom: none; }
.vp-story-item__main { flex: 1; display: grid; min-width: 0; }
.vp-story-item__main strong { font-size: 13px; }
.vp-story-item__main span { font-size: 11.5px; color: var(--mk-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.vp-runs { display: grid; }
.vp-run {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.vp-run:last-child { border-bottom: none; }
.vp-run__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.vp-run__dot.is-ok { background: var(--mk-green); }
.vp-run__dot.is-warn { background: var(--mk-amber); }
.vp-run__dot.is-bad { background: var(--mk-red); }
.vp-run__main { flex: 1; display: grid; min-width: 0; }
.vp-run__main strong { font-size: 13px; }
.vp-run__main span { font-size: 11.5px; color: var(--mk-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-run__time { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }
.vp-none { margin: 0; padding: 16px; color: var(--mk-faint); font-size: 12.5px; }
.mk-link--danger { color: var(--mk-red, #dc2626); }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }

.vp-preview {
  padding: 14px 16px;
  border: 1px dashed var(--mk-line);
  border-radius: 12px;
  display: grid;
  gap: 6px;
}
.vp-preview h4 { margin: 0; font-size: 12px; color: var(--mk-muted); }
.vp-preview p { margin: 0; font-size: 12px; color: var(--mk-faint); line-height: 1.7; }

@media (max-width: 900px) {
  .vp-grid { grid-template-columns: 1fr; }
}

/* =====故事高级诊断折叠区 ===== */
.vp-story-item__main { display: grid; gap: 4px; }
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
