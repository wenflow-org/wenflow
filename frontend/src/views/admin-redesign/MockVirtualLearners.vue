<template>
  <div class="mk-page">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ samples.length ? `实验进行中：${runningCount} 个运行中` : '还没有虚拟学习者' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">样本 {{ samples.length }}</span>
      <span class="mk-status__meta">跑通 Goal/Path {{ goalRate }}</span>
      <span class="mk-status__meta">Learn 完成 {{ learnRate }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="createOpen = true">新建虚拟学习者</button>
    </div>

    <div v-if="toast" class="mk-toast mk-toast--ok">✓ {{ toast }}</div>

    <!-- 实验进度看板 -->
    <div v-if="samples.length" class="vl-board">
      <div class="vl-board__item">
        <span>样本与故事</span>
        <strong>{{ samples.length }}</strong>
        <em>{{ withStory }} 个有完整故事</em>
      </div>
      <div class="vl-board__item">
        <span>Goal / Path</span>
        <strong>{{ goalRate }}</strong>
        <em>{{ goalDone }}/{{ samples.length }} 进入路径阶段</em>
      </div>
      <div class="vl-board__item">
        <span>Learn 完成</span>
        <strong>{{ learnRate }}</strong>
        <em>{{ learnDone }}/{{ samples.length }} 完整跑通</em>
      </div>
      <div class="vl-board__item">
        <span>状态分布</span>
        <strong class="vl-board__dots">
          <i v-for="s in samples" :key="s.id" :class="`dot--${s.status}`" :title="`${s.name}：${statusText(s.status)}`"></i>
        </strong>
        <em>逐样本状态点</em>
      </div>
    </div>

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
            <th>实验进度</th>
            <th>状态</th>
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
                <span class="vl-story__bar"><i :style="{ width: s.story + '%' }"></i></span>
                <span class="mk-num">{{ s.story }}%</span>
              </div>
            </td>
            <td class="mk-num">{{ s.progress }}</td>
            <td><span class="mk-badge" :class="statusBadge(s.status)">{{ statusText(s.status) }}</span></td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link">运行</button>
                <button type="button" class="mk-link" @click="openSubPage('virtual', s.id)">画像</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>{{ samples.length ? '没有匹配的样本' : '还没有虚拟学习者' }}</strong>
        <span>从「新建虚拟学习者」写一个故事开始：她是谁、想解决什么。</span>
      </div>
    </div>

    <!-- 新建虚拟学习者 -->
    <div v-if="createOpen" class="mk-modal" @mousedown.self="createOpen = false">
      <div class="mk-modal__panel" role="dialog" aria-label="新建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">新建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
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
            <span class="mk-field__label">她的故事</span>
            <textarea v-model="form.story" class="mk-field__textarea" placeholder="她是谁、卡在哪、为什么现在要学？越具体，模拟越真实。"></textarea>
            <span class="mk-field__hint">{{ form.story.length }} 字 · 建议 ≥ 40 字</span>
            <span v-if="errors.story" class="mk-field__err">{{ errors.story }}</span>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" @click="createSample">创建并生成画像</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage } from './mockStore'

const props = defineProps<{ state: 'normal' | 'empty' }>()

interface Sample {
  id: string
  name: string
  goal: string
  story: number
  progress: string
  status: 'ready' | 'running' | 'review' | 'done'
}

const all: Sample[] = [
  { id: 'vl-001', name: '疲惫的运营小张', goal: '把 Excel 周报自动化', story: 92, progress: 'Learn 3/5', status: 'running' },
  { id: 'vl-002', name: '转行的前教师', goal: '系统学数据分析', story: 78, progress: 'Path 已生成', status: 'ready' },
  { id: 'vl-003', name: '拖延的研究生', goal: '30 天写完论文初稿', story: 85, progress: '完成', status: 'review' }
]

const samples = ref<Sample[]>([])
watch(
  () => props.state,
  (s) => {
    samples.value = s === 'empty' ? [] : all
  },
  { immediate: true }
)

const keyword = ref('')
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return samples.value
  return samples.value.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
})

/* 新建虚拟学习者：校验 + 真实加样本 */
const createOpen = ref(false)
const form = ref({ name: '', goal: '', story: '' })
const errors = ref<{ name?: string; goal?: string; story?: string }>({})
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function createSample() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入样本名'
  if (!form.value.goal.trim()) errors.value.goal = '请输入学习目标'
  if (form.value.story.trim().length < 20) errors.value.story = '故事至少 20 字，模拟才有依据'
  if (Object.keys(errors.value).length) return

  const storyPct = Math.min(30 + Math.floor(form.value.story.trim().length / 4), 95)
  samples.value.unshift({
    id: `vl-${String(samples.value.length + 1).padStart(3, '0')}`,
    name: form.value.name.trim(),
    goal: form.value.goal.trim(),
    story: storyPct,
    progress: '待运行',
    status: 'ready'
  })
  createOpen.value = false
  form.value = { name: '', goal: '', story: '' }
  toast.value = '样本已创建，画像推断完成，可运行'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

const runningCount = computed(() => samples.value.filter((s) => s.status === 'running').length)
const withStory = computed(() => samples.value.filter((s) => s.story >= 80).length)
const goalDone = computed(() => samples.value.filter((s) => s.status !== 'ready').length)
const learnDone = computed(() => samples.value.filter((s) => s.progress === '完成').length)
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—')
const goalRate = computed(() => pct(goalDone.value, samples.value.length))
const learnRate = computed(() => pct(learnDone.value, samples.value.length))

const statusText = (s: string) => ({ ready: '可运行', running: '运行中', review: '待评审', done: '完成' }[s] || s)
const statusBadge = (s: string) => ({ ready: 'mk-badge--info', running: 'mk-badge--ok', review: 'mk-badge--warn', done: 'mk-badge--muted' }[s])
</script>

<style scoped>
.vl-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.vl-board__item {
  display: grid;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
}
.vl-board__item span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.vl-board__item strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.vl-board__item em { font-style: normal; font-size: 11.5px; color: var(--mk-faint); }
.vl-board__dots { display: flex; gap: 5px; align-items: center; min-height: 28px; }
.vl-board__dots i { width: 9px; height: 9px; border-radius: 50%; }
.dot--ready { background: #7aa8f8; }
.dot--running { background: #4ade80; animation: vl-pulse 1.6s ease infinite; }
.dot--review { background: #fbbf24; }
.dot--done { background: #c3cede; }
@keyframes vl-pulse { 50% { opacity: 0.35; } }

.vl-story { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.vl-story__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #eef2fa;
  overflow: hidden;
}
.vl-story__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, #3478f6); }

@media (max-width: 900px) {
  .vl-board { grid-template-columns: repeat(2, 1fr); }
}
</style>
