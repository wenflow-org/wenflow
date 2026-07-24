<template>
  <div class="mk-page">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ samples.length ? `${samples.length} 个样本就绪` : '还没有虚拟学习者' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">样本 {{ samples.length }}</span>
      <span class="mk-status__meta">有故事 {{ withStory }}</span>
      <span class="mk-status__meta">累计会话 {{ totalSessions }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建虚拟学习者</button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">样本列表</h3>
        <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / 学习目标" />
      </div>

      <table v-if="filtered.length" class="mk-table mk-table--click">
        <thead>
          <tr>
            <th>样本</th>
            <th>学习目标</th>
            <th>故事完整度</th>
            <th>会话</th>
            <th>创建</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ s.name }}</strong>
                <span class="mk-cell-sub">{{ s.id }}</span>
              </div>
            </td>
            <td>{{ s.goal }}</td>
            <td>
              <div class="vl-story">
                <span class="vl-story__bar"><i :style="{ width: s.storyPct + '%' }"></i></span>
                <span class="mk-num">{{ s.storyPct }}%</span>
              </div>
            </td>
            <td class="mk-num">{{ s.sessions }}</td>
            <td class="mk-na">{{ s.created }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openSubPage('virtual', s.id)">画像</button>
                <button v-if="isLive" type="button" class="mk-link" @click="openLaunch(s)">运行</button>
                <button v-if="isLive" type="button" class="mk-link mk-link--danger" :disabled="s.busy" @click="removeSample(s)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>{{ samples.length ? '没有匹配的样本' : '还没有虚拟学习者' }}</strong>
        <span>从「新建虚拟学习者」写一个故事开始：她是谁、想解决什么问题。</span>
      </div>
    </div>

    <!-- 新建虚拟学习者 -->
    <div v-if="createOpen" class="mk-modal" @mousedown.self="createOpen = false">
      <div class="mk-modal__panel" role="dialog" aria-label="新建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">新建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">×</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">样本名</span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如 焦虑的转行者" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.goal }">
            <span class="mk-field__label">学习目标</span>
            <input v-model="form.goal" class="mk-field__input" placeholder="例如 两个月入门产品经理" />
            <span v-if="errors.goal" class="mk-field__err">{{ errors.goal }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.story }">
            <span class="mk-field__label">人物背景</span>
            <textarea
              v-model="form.story"
              class="mk-field__textarea"
              placeholder="她是谁、长期处境、学习相关底色。这里写「稳定身份」，不是某次具体事件故事。"
            ></textarea>
            <span class="mk-field__hint">{{ form.story.length }} 字 · 建议 ≥ 40 字 · 会话故事请在画像页另生成</span>
            <span v-if="errors.story" class="mk-field__err">{{ errors.story }}</span>
          </label>
          <button v-if="isLive" type="button" class="mk-link vl-ai" :disabled="personaBusy" @click="generatePersona">
            {{ personaBusy ? '生成身份中…' : '✦ AI 生成身份（人设设计）' }}
          </button>
          <p v-if="isLive" class="vl-ai-hint">
            调用 Skill：virtual-learner-persona-designer · 只生成稳定人设，不生成故事/情境
          </p>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="createSample">
            {{ creating ? '创建中…' : isLive ? '创建（真实写入）' : '创建并生成画像' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 启动实验 -->
    <div v-if="launchTarget" class="mk-modal" @mousedown.self="launchTarget = null">
      <div class="mk-modal__panel" role="dialog" aria-label="启动实验">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">启动实验 · {{ launchTarget.name }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="launchTarget = null">✕</button>
        </div>
        <div class="mk-modal__body">
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
          <button type="button" class="mk-btn mk-btn--primary" :disabled="launchBusy" @click="startLaunch">
            {{ launchBusy ? '启动中…' : '启动会话' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, dataSource } from './mockStore'
import { liveVirtuals, liveCreateVirtual, liveDeleteVirtual, timeAgo, errMsg } from './mockLive'
import { adminVirtualLearnersApi } from '@/api/adminApi'

const props = defineProps<{ state: 'normal' | 'empty' }>()

const isLive = computed(() => dataSource.value === 'live')

interface Sample {
  id: string
  name: string
  goal: string
  storyPct: number
  sessions: number
  created: string
  busy?: boolean
}

const all: Sample[] = [
  { id: 'vl-001', name: '疲惫的运营小张', goal: '把 Excel 周报自动化', storyPct: 92, sessions: 4, created: '3 天前' },
  { id: 'vl-002', name: '转行的前教师', goal: '系统学数据分析', storyPct: 78, sessions: 1, created: '1 天前' },
  { id: 'vl-003', name: '拖延的研究生', goal: '30 天写完论文初稿', storyPct: 85, sessions: 2, created: '6 小时前' },
  { id: 'vl-004', name: '焦虑的实习产品经理', goal: '两周上手需求文档', storyPct: 64, sessions: 1, created: '昨天 22:10' },
  { id: 'vl-005', name: '退休学摄影的阿姨', goal: '学会手机修图', storyPct: 41, sessions: 0, created: '2 小时前' }
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
      storyPct: Math.min(30 + Math.floor(v.story.length / 4), 95),
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

/* 新建 */
const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', goal: '', story: '' })
const errors = ref<{ name?: string; goal?: string; story?: string }>({})
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
  form.value = { name: '', goal: '', story: '' }
  errors.value = {}
  personaSeed.value = null
  createOpen.value = true
}

async function createSample() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入样本名'
  if (!form.value.goal.trim()) errors.value.goal = '请输入学习目标'
  if (form.value.story.trim().length < 20) errors.value.story = '人物背景至少 20 字，模拟才有依据'
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    if (isLive.value) {
      await liveCreateVirtual({
        name: form.value.name.trim(),
        goal: form.value.goal.trim(),
        story: form.value.story.trim(),
        personaSeed: personaSeed.value || undefined
      })
      showToast('样本已创建。会话故事请到画像页生成')
    } else {
      demoSamples.value.unshift({
        id: `vl-${String(demoSamples.value.length + 1).padStart(3, '0')}`,
        name: form.value.name.trim(),
        goal: form.value.goal.trim(),
        storyPct: Math.min(30 + Math.floor(form.value.story.trim().length / 4), 95),
        sessions: 0,
        created: '刚刚'
      })
      showToast('样本已创建，画像推断完成，可运行')
    }
    createOpen.value = false
  } catch (e) {
    showToast(`创建失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    creating.value = false
  }
}

async function removeSample(s: Sample) {
  if (!window.confirm(`确认删除样本「${s.name}」？其会话记录将一并清理。`)) return
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

/* AI 生成身份：skill:virtual-learner-persona-designer（只做人设，不写故事） */
const personaBusy = ref(false)
const personaSeed = ref<Record<string, unknown> | null>(null)
async function generatePersona() {
  if (personaBusy.value) return
  // 有学习目标时再调 skill，否则生成结果漂
  if (!form.value.goal.trim() && !form.value.name.trim() && !form.value.story.trim()) {
    errors.value = { goal: '先填学习目标，或至少写一点背景，再生成身份' }
    return
  }
  personaBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.generatePersona({
      existingPersonaSeed: {
        name: form.value.name.trim() || undefined,
        learningGoal: form.value.goal.trim() || undefined,
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
    // 人设 skill 产出 nameHint/occupation/background，不产出「故事」
    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim()
    if (nameFromSeed) form.value.name = nameFromSeed
    const goalFromSeed = String(seed.learningGoal || '').trim()
    if (goalFromSeed) form.value.goal = goalFromSeed
    const background = String(seed.background || seed.corePersonality || seed.behavioralProfileSummary || '').trim()
    if (background) form.value.story = background
    showToast('人设已生成并回填（背景≠故事），可继续改')
  } catch (e) {
    showToast(`生成失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    personaBusy.value = false
  }
}

/* 启动实验：辅助 / 黑盒 + 对抗预算 */
const launchTarget = ref<Sample | null>(null)
const launchForm = ref({ mode: 'assisted' as 'assisted' | 'blackbox', friction: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test' })
const launchBusy = ref(false)

function openLaunch(s: Sample) {
  launchTarget.value = s
  launchForm.value = { mode: 'assisted', friction: 'normal' }
}

async function startLaunch() {
  const target = launchTarget.value
  if (!target || launchBusy.value) return
  launchBusy.value = true
  try {
    const payload = { frictionBudget: launchForm.value.friction }
    const res =
      launchForm.value.mode === 'blackbox'
        ? await adminVirtualLearnersApi.startBlackboxVirtualSession(target.id, payload)
        : await adminVirtualLearnersApi.startVirtualSession(target.id, payload)
    const session = res.data?.data ?? res.data ?? {}
    const sid = String(session.id || session.sessionId || '')
    launchTarget.value = null
    showToast(`会话已启动：${sid.slice(0, 18)}${sid.length > 18 ? '…' : ''}，可在画像页查看`)
    openSubPage('virtual', target.id)
  } catch (e) {
    showToast(`启动失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    launchBusy.value = false
  }
}

const withStory = computed(() => samples.value.filter((s) => s.storyPct >= 60).length)
const totalSessions = computed(() => samples.value.reduce((a, s) => a + s.sessions, 0))
</script>

<style scoped>
.vl-story { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.vl-story__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #eef2fa;
  overflow: hidden;
}
.vl-story__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, #3478f6); }
.mk-link--danger { color: var(--mk-red, #dc2626); }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.vl-ai { justify-self: start; }
.vl-ai-hint {
  margin: -4px 0 0;
  font-size: 11px;
  color: var(--mk-faint, #8492ab);
  line-height: 1.45;
}
</style>
