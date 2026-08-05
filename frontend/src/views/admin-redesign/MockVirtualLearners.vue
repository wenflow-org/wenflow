<template>
  <div class="mk-page">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ samples.length ? `${samples.length} 个样本就绪` : '还没有虚拟学习者' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">样本 {{ samples.length }}</span>
      <span class="mk-status__meta">有故事 {{ withStory }}</span>
      <span class="mk-status__meta">会话 {{ totalSessions }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建样本</button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">样本列表</h3>
        <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
      </div>

      <div v-if="filtered.length" class="mk-table-scroll">
      <table class="mk-table mk-table--click">
        <thead>
          <tr>
            <th>样本</th>
            <th>长期倾向</th>
            <th>故事池</th>
            <th>会话</th>
            <th>创建</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id" class="vl-row" @click="openSubPage('virtual', s.id)">
            <td>
              <div class="mk-cell-main">
                <strong>{{ s.name }}</strong>
                <span class="mk-cell-sub">{{ s.id }}</span>
              </div>
            </td>
            <td>{{ s.goal || '—' }}</td>
            <td>
              <span class="mk-badge" :class="s.storyCount > 0 ? 'mk-badge--ok' : 'mk-badge--muted'">
                {{ s.storyCount > 0 ? `${s.storyCount} 条` : '未生成' }}
              </span>
            </td>
            <td class="mk-num">{{ s.sessions }}</td>
            <td class="mk-na">{{ s.created }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openSubPage('virtual', s.id)">画像</button>
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-link"
                  :class="{ 'mk-link--muted': s.storyCount === 0 }"
                  :title="s.storyCount === 0 ? '建议先在画像页生成故事' : '启动实验会话'"
                  @click.stop="openLaunch(s)"
                >
                  运行
                </button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="s.busy" @click="menuRemove(s)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else class="mk-empty">
        <strong>{{ samples.length ? '没有匹配的样本' : '暂无虚拟学习者' }}</strong>
        <span>新建虚拟人后，在画像页生成故事即可运行。</span>
      </div>
    </div>

    <!-- 新建虚拟学习者 -->
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="新建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">新建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <p class="vl-steps">
            ① 称呼与背景 → ② AI 补全身份（可选）→ ③ 创建 → ④ 画像页生成故事 → ⑤ 按故事运行
          </p>
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">称呼 / 样本名 <em class="vl-req">必填</em></span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如 焦虑的转行者、自由职业写作者" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.story }">
            <span class="mk-field__label">人物背景 <em class="vl-req">必填</em></span>
            <textarea
              v-model="form.story"
              class="mk-field__textarea"
              placeholder="她是谁、职业处境、性格与长期底色。这里只写稳定身份，不要写某次具体学习事件。"
            ></textarea>
            <span class="mk-field__hint">{{ form.story.length }} 字 · 建议 ≥ 40 字 · 具体学习需求在画像页用「故事」产生</span>
            <span v-if="errors.story" class="mk-field__err">{{ errors.story }}</span>
          </label>
          <div v-if="isLive" class="vl-ai-row">
            <button type="button" class="mk-btn mk-btn--ghost vl-ai" :disabled="personaBusy" @click="generatePersona">
              {{ personaBusy ? '生成身份中…' : '✦ AI 生成身份' }}
            </button>
            <span class="vl-ai-hint">人设 Skill · 只补稳定身份，不依赖学习目标，不写会话故事</span>
          </div>
          <p v-if="personaSeed" class="vl-persona-ok">已回填人设，可改称呼/背景后创建</p>
          <details class="vl-advanced">
            <summary>可选 · 长期学习倾向（不是某次故事的目标）</summary>
            <label class="mk-field">
              <span class="mk-field__label">长期倾向</span>
              <input
                v-model="form.aspiration"
                class="mk-field__input"
                placeholder="例如 总想补职场工具；可留空，由故事 goalSeed 定义当次需求"
              />
              <span class="mk-field__hint">写入画像备用字段；真正驱动 Path 的是故事里的学习需求</span>
            </label>
          </details>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="createSample">
            {{ creating ? '创建中…' : '创建虚拟人' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 启动实验：必须选故事（一人多故事 → 一故事一 Path） -->
    <div v-if="launchTarget" ref="launchMaskRef" class="mk-modal">
      <div ref="launchPanelRef" class="mk-modal__panel" role="dialog" aria-label="启动实验">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">启动实验 · {{ launchTarget.name }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="launchTarget = null">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field">
            <span class="mk-field__label">选择故事 <em class="vl-req">必填</em></span>
            <select v-model="launchForm.storyId" class="mk-field__select" :disabled="launchStoriesLoading">
              <option disabled value="">
                {{ launchStoriesLoading ? '加载故事中…' : launchStories.length ? '请选择故事' : '暂无故事，请先在画像页生成' }}
              </option>
              <option v-for="st in launchStories" :key="st.id" :value="st.id">
                {{ st.title }}{{ st.pathId ? ' · 已有 Path' : ' · 尚无 Path' }}（运行 {{ st.runCount }}）
              </option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">运行模式</span>
            <select v-model="launchForm.mode" class="mk-field__select">
              <option value="assisted">辅助模拟（白盒，链路可控）</option>
              <option value="blackbox">黑盒 API（裁判评估，贴近真实）</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">对抗预算</span>
            <select v-model="launchForm.friction" class="mk-field__select">
              <option value="none">无摩擦</option>
              <option value="low">低</option>
              <option value="normal">正常</option>
              <option value="high">高</option>
              <option value="stress_test">压力测试</option>
            </select>
            <span class="mk-field__hint">预算越高，虚拟学习者越"难带"：分心、畏难、追问</span>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="launchTarget = null">取消</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="launchBusy || !launchForm.storyId"
            @click="startLaunch"
          >
            {{ launchBusy ? '启动中…' : '按故事启动' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, dataSource, intent } from './mockStore'
import { liveVirtuals, liveCreateVirtual, liveDeleteVirtual, timeAgo, errMsg } from './mockLive'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'

const props = defineProps<{ state: 'normal' | 'empty' }>()

const isLive = computed(() => dataSource.value === 'live')

interface Sample {
  id: string
  name: string
  goal: string
  storyCount: number
  sessions: number
  created: string
  busy?: boolean
}

const all: Sample[] = [
  { id: 'vl-001', name: '疲惫的运营小张', goal: '把 Excel 周报自动化', storyCount: 2, sessions: 4, created: '3 天前' },
  { id: 'vl-002', name: '转行的前教师', goal: '系统学数据分析', storyCount: 1, sessions: 1, created: '1 天前' },
  { id: 'vl-003', name: '拖延的研究生', goal: '30 天写完论文初稿', storyCount: 1, sessions: 2, created: '6 小时前' },
  { id: 'vl-004', name: '焦虑的实习产品经理', goal: '两周上手需求文档', storyCount: 0, sessions: 1, created: '昨天 22:10' },
  { id: 'vl-005', name: '退休学摄影的阿姨', goal: '学会手机修图', storyCount: 0, sessions: 0, created: '2 小时前' }
]

const demoSamples = ref<Sample[]>([])
watch(
  () => props.state,
  (s) => {
    demoSamples.value = s === 'empty' ? [] : [...all]
  },
  { immediate: true }
)

const samples = computed<Sample[]>(() => {
  if (isLive.value) {
    return liveVirtuals.value.map((v) => ({
      id: v.id,
      name: v.name,
      goal: v.goal,
      storyCount: Number(v.storyCount || 0),
      sessions: v.sessions,
      created: timeAgo(v.createdAt)
    }))
  }
  return demoSamples.value
})

const keyword = ref('')
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return samples.value
  return samples.value.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
})

/* 新建：人设优先（学习需求由故事产生，不在创建时必填） */
const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', story: '', aspiration: '' })
const errors = ref<{ name?: string; story?: string }>({})
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

function openCreate() {
  form.value = { name: '', story: '', aspiration: '' }
  errors.value = {}
  personaSeed.value = null
  createOpen.value = true
}

async function createSample() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入称呼 / 样本名'
  if (form.value.story.trim().length < 20) errors.value.story = '人物背景至少 20 字，稳定人设才有依据'
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    if (isLive.value) {
      await liveCreateVirtual({
        name: form.value.name.trim(),
        goal: form.value.aspiration.trim(),
        story: form.value.story.trim(),
        personaSeed: personaSeed.value || undefined
      })
      createOpen.value = false
      const created = liveVirtuals.value[0]
      if (created?.id) {
        showToast('虚拟人已创建。下一步：在画像页生成故事（产生学习需求）')
        openSubPage('virtual', created.id)
      } else {
        showToast('虚拟人已创建')
      }
    } else {
      const id = `vl-${String(demoSamples.value.length + 1).padStart(3, '0')}`
      demoSamples.value.unshift({
        id,
        name: form.value.name.trim(),
        goal: form.value.aspiration.trim() || '—',
        storyCount: 0,
        sessions: 0,
        created: '刚刚'
      })
      createOpen.value = false
      showToast('虚拟人已创建（演示）。下一步生成故事')
      openSubPage('virtual', id)
    }
  } catch (e) {
    showToast(`创建失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    creating.value = false
  }
}

async function removeSample(s: Sample) {
  const ok = await askConfirm({
    title: '删除虚拟学习者',
    message: `确认删除样本「${s.name}」？\n其会话记录将一并清理，该操作不可撤销。`,
    confirmText: '删除'
  })
  if (!ok) return
  s.busy = true
  try {
    await liveDeleteVirtual(s.id)
    showToast(`「${s.name}」已删除`)
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    s.busy = false
  }
}

/* AI 生成身份：skill:virtual-learner-persona-designer（只做人设，不依赖学习目标、不写故事） */
const personaBusy = ref(false)
const personaSeed = ref<Record<string, unknown> | null>(null)
async function generatePersona() {
  if (personaBusy.value) return
  personaBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.generatePersona({
      existingPersonaSeed: {
        name: form.value.name.trim() || undefined,
        nameHint: form.value.name.trim() || undefined,
        notes: form.value.story.trim() || undefined,
        background: form.value.story.trim() || undefined
      }
    })
    const d = res.data?.data ?? res.data ?? {}
    const seed = (d.personaSeed || d.profile || d) as Record<string, unknown>
    if (!seed || typeof seed !== 'object') {
      showToast('生成失败：未返回 personaSeed', 'mk-toast--bad')
      return
    }
    personaSeed.value = seed
    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim()
    if (nameFromSeed) form.value.name = nameFromSeed
    const background = String(seed.background || seed.corePersonality || seed.behavioralProfileSummary || '').trim()
    if (background) form.value.story = background
    showToast('人设已回填，可改后点「创建虚拟人」')
  } catch (e) {
    showToast(`生成失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    personaBusy.value = false
  }
}

/* 启动实验：必须选故事（一人多故事 → 一故事一 Path） */
interface LaunchStory {
  id: string
  title: string
  runCount: number
  pathId: string | null
}
const launchTarget = ref<Sample | null>(null)
useEscape(() => createOpen.value, () => { createOpen.value = false })
useEscape(() => !!launchTarget.value, () => { launchTarget.value = null })

const { openMenu, toggleMenu, closeMenu } = useRowMenu()
/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const launchPanelRef = ref<HTMLElement | null>(null)
const launchMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })
useOverlay(computed(() => !!launchTarget.value), launchPanelRef)
useMaskClose(launchMaskRef, () => { launchTarget.value = null })

/* 命令面板快捷动作：直达并打开新建弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-virtual') {
      intent.quickAction = ''
      createOpen.value = true
    }
  },
  { immediate: true }
)
const launchForm = ref({
  storyId: '',
  mode: 'assisted' as 'assisted' | 'blackbox',
  friction: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test'
})
const launchBusy = ref(false)
const launchStoriesLoading = ref(false)
const launchStories = ref<LaunchStory[]>([])

async function openLaunch(s: Sample) {
  if (s.storyCount === 0 && isLive.value) {
    showToast('请先在画像页生成故事；故事产生学习需求后才能运行', 'mk-toast--bad')
    openSubPage('virtual', s.id)
    return
  }
  launchTarget.value = s
  launchForm.value = { storyId: '', mode: 'assisted', friction: 'normal' }
  launchStories.value = []
  if (!isLive.value) {
    launchStories.value = [
      { id: 'demo-s1', title: '演示故事 A', runCount: 1, pathId: 'demo-p1' },
      { id: 'demo-s2', title: '演示故事 B', runCount: 0, pathId: null }
    ]
    launchForm.value.storyId = launchStories.value[0].id
    return
  }
  launchStoriesLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearnerStories(s.id)
    const body = res.data?.data ?? res.data ?? {}
    const list = Array.isArray(body.stories) ? body.stories : []
    launchStories.value = list.map((st: Record<string, unknown>, index: number) => {
      const stats = (st.stats || {}) as Record<string, unknown>
      const latest = (st.latestRun || {}) as Record<string, unknown>
      const bindings = (latest.bindings || {}) as Record<string, unknown>
      return {
        id: String(st.storyId || st.id || st.key || `story-${index}`),
        title: String(st.storyTitle || st.title || `故事 ${index + 1}`),
        runCount: Number(stats.totalRuns ?? 0),
        pathId: bindings.learningPathId ? String(bindings.learningPathId) : null
      }
    })
    if (!launchStories.value.length) {
      showToast('该虚拟人还没有故事，请先在画像页生成', 'mk-toast--bad')
      launchTarget.value = null
      openSubPage('virtual', s.id)
      return
    }
    if (launchStories.value.length === 1) {
      launchForm.value.storyId = launchStories.value[0].id
    }
  } catch (e) {
    showToast(`加载故事失败：${errMsg(e)}`, 'mk-toast--bad')
    launchTarget.value = null
  } finally {
    launchStoriesLoading.value = false
  }
}

async function startLaunch() {
  const target = launchTarget.value
  if (!target || launchBusy.value) return
  if (!launchForm.value.storyId) {
    showToast('请选择故事；每个故事对应一套学习任务（Path）', 'mk-toast--bad')
    return
  }
  launchBusy.value = true
  try {
    const payload = {
      storyId: launchForm.value.storyId,
      frictionBudget: launchForm.value.friction
    }
    const res =
      launchForm.value.mode === 'blackbox'
        ? await adminVirtualLearnersApi.startBlackboxVirtualSession(target.id, payload)
        : await adminVirtualLearnersApi.startVirtualSession(target.id, payload)
    const session = res.data?.data ?? res.data ?? {}
    const sid = String(session.id || session.sessionId || '')
    const storyTitle = launchStories.value.find((x) => x.id === launchForm.value.storyId)?.title || '故事'
    launchTarget.value = null
    showToast(`已按「${storyTitle}」启动：${sid.slice(0, 14)}${sid.length > 14 ? '…' : ''}`)
    openSubPage('virtual', target.id)
  } catch (e) {
    showToast(`启动失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    launchBusy.value = false
  }
}

const withStory = computed(() => samples.value.filter((s) => s.storyCount > 0).length)
const totalSessions = computed(() => samples.value.reduce((a, s) => a + s.sessions, 0))
</script>

<style scoped>
.mk-link--danger { color: var(--mk-red, #dc2626); }
.mk-link--muted { opacity: 0.55; }
.vl-row { cursor: pointer; }
.vl-row:hover { background: #f6f9ff; }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.vl-steps {
  margin: 0 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--mk-muted, #5b6577);
  font-size: 11.5px;
  line-height: 1.5;
}
.vl-req {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-blue, #3478f6);
  margin-left: 4px;
}
.vl-ai-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 2px 0 4px;
}
.vl-ai { flex: 0 0 auto; }
.vl-ai-hint {
  margin: 0;
  font-size: 11px;
  color: var(--mk-faint, #8492ab);
  line-height: 1.45;
}
.vl-persona-ok {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: #e8f7ee;
  color: #1a7f4b;
  font-size: 12px;
  font-weight: 600;
}
.vl-advanced {
  margin-top: 4px;
  border-radius: 10px;
  border: 1px solid #e8ecf2;
  background: #fafbfd;
  padding: 8px 12px;
}
.vl-advanced summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--mk-muted, #5b6577);
  list-style: none;
}
.vl-advanced summary::-webkit-details-marker { display: none; }
.vl-advanced[open] summary { margin-bottom: 8px; }
.vl-advanced .mk-field { margin-bottom: 0; }
.mk-btn--ghost {
  border: 1px solid rgba(52, 120, 246, 0.28);
  background: #eef5ff;
  color: var(--mk-blue, #1f57cc);
  font-weight: 700;
}
.mk-btn--ghost:hover:not(:disabled) {
  background: #dbeafe;
}
.mk-btn--ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 数值列（会话）表头与单元格居中 */
.mk-table td.mk-num,
.mk-table th:nth-child(4) { text-align: center; }
</style>
