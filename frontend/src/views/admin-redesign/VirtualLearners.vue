<template>
  <div class="mk-page">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ samples.length ? `${samples.length} 个虚拟学习者` : '还没有虚拟学习者' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" :title="'全量口径：会话处于创建中状态的数量'">创建中 {{ partition.created }}</span>
      <span class="mk-status__meta vl-status-run" :title="'全量口径：运行中会话数（含卡死）'">运行中 {{ partition.running }}</span>
      <span class="mk-status__meta vl-status-fail" :title="'全量口径：失败/放弃会话数'">已失败 {{ partition.failed }}</span>
      <span v-if="partition.stale > 0" class="mk-status__meta vl-status-stale" :title="'超过回收阈值无写入且无活跃租约，可一键回收'">
        卡死 {{ partition.stale }}
      </span>
      <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-status__meta vl-truncated" :title="`后端共 ${liveVirtualsTotal} 人，列表仅加载前 ${samples.length} 行`">
        已截断 · 共 {{ liveVirtualsTotal }} 人
      </span>
      <button
        v-if="partition.stale > 0"
        type="button"
        class="mk-status__action vl-status-reclaim"
        :disabled="reclaimBusy"
        :title="'干跑确认清单后批量标记卡死会话为失败'"
        @click="openReclaimModal()"
      >
        {{ reclaimBusy ? '回收中…' : `一键回收卡死（${partition.stale}）` }}
      </button>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建虚拟学习者</button>
    </div>


    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">虚拟学习者列表</h3>
        <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
      </div>

      <MockSkeletonTable v-if="liveLoading && !samples.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll">
      <table class="mk-table mk-table--click">
        <thead>
          <tr>
            <th v-if="isLive" scope="col" style="width:32px">
              <input type="checkbox" aria-label="全选" :checked="allChecked" @change="toggleAll" />
            </th>
            <th>虚拟学习者</th>
            <th>长期倾向</th>
            <th>故事池</th>
            <th class="mk-th--right">会话</th>
            <th title="当前会话状态：运行中会话数 + 最近阶段；会话数为累计口径；卡死/失败为全量聚合">运行中</th>
            <th class="mk-col--time-full">创建</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in shown" :key="s.id" class="vl-row" @click="openSubPage('virtual', s.id)">
            <td v-if="isLive"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="mk-cell-main">
                <strong>{{ s.name }}</strong>
                <span class="mk-cell-sub">{{ s.id }}</span>
              </div>
            </td>
            <td><span class="vl-goal" :title="s.goal || undefined">{{ s.goal || '—' }}</span></td>
            <td>
              <span class="mk-badge" :class="s.storyCount > 0 ? 'mk-badge--ok' : 'mk-badge--muted'">
                {{ s.storyCount > 0 ? `${s.storyCount} 条` : '未生成' }}
              </span>
            </td>
            <td class="mk-num">{{ s.sessions }}</td>
            <td>
              <span
                v-if="s.runningCount > 0"
                class="vl-run vl-run--live"
                :class="{ 'vl-run--stalled': s.stalledCount > 0 }"
                :title="`${s.runningCount} 个会话运行中 · 当前阶段 ${stageLabel(s.currentStage)}${s.runningSessionIds.length ? '；点击进入会话座舱' : ''}`"
                @click.stop="openRunningSession(s)"
              >
                ● {{ s.runningCount }} 运行中 · {{ stageLabel(s.currentStage) }}
              </span>
              <span v-else class="vl-run" title="当前没有运行中的会话">空闲</span>
              <span v-if="s.stalledCount > 0" class="vl-badge vl-badge--bad" :title="`${s.stalledCount} 个运行中会话已卡死（超过回收阈值无写入）`">卡死 {{ s.stalledCount }}</span>
              <span v-if="s.failedCount > 0" class="vl-badge vl-badge--bad" :title="`${s.failedCount} 个会话已失败/放弃`">失败 {{ s.failedCount }}</span>
            </td>
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
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="busyId === s.id" @click="menuRemove(s)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else-if="loadFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>虚拟学习者加载失败</strong>
        <span>无法从后端拉取虚拟学习者列表。</span>
        <button type="button" class="mk-empty__action" @click="retryLoad">重试</button>
      </div>
      <div v-else class="mk-empty">
        <strong>{{ samples.length ? '没有匹配的虚拟学习者' : '暂无虚拟学习者' }}</strong>
        <span>新建虚拟学习者后，在画像页生成故事即可运行。</span>
        <button v-if="isFiltered && samples.length" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
      </div>
      <div v-if="canMore" class="vl-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }}）</button>
      </div>
    </div>

    <!-- 批量操作条（对齐 Users.vue 模式：选中后底部浮现；批量删除待 2B 后端打通） -->
    <div v-if="isLive && selected.length" class="vl-batch">
      <span>已选 {{ selected.length }} 人</span>
      <button type="button" class="mk-link" @click="selected = []">取消选择</button>
      <button type="button" class="vl-batch__btn" :disabled="batchBusy" @click="batchTerminate">
        {{ batchBusy ? '处理中…' : '批量终止' }}
      </button>
      <button type="button" class="vl-batch__btn" :disabled="batchBusy" @click="batchReclaim">
        {{ batchBusy ? '处理中…' : '批量清理卡死' }}
      </button>
      <button type="button" class="vl-batch__danger" disabled title="待 2B 后端打通：删除当前被 409 会话/教学记录死锁阻塞">
        批量删除
      </button>
    </div>

    <!-- 一键回收卡死：dryRun 先展示清单再确认执行（复用 reclaim-stale dryRun 语义） -->
    <div v-if="reclaimOpen" ref="reclaimMaskRef" class="mk-modal">
      <div ref="reclaimPanelRef" class="mk-modal__panel" role="dialog" :aria-label="reclaimProfileIds ? '批量清理卡死会话' : '一键回收卡死会话'">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ reclaimProfileIds ? `批量清理卡死会话（选中 ${selected.length} 人）` : '一键回收卡死会话' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="reclaimOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <p class="vl-steps">
            将把{{ reclaimProfileIds ? '选中虚拟人' : '全部' }}超过回收阈值（{{ reclaimThresholdLabel }}）无写入、且无活跃租约的会话标记为失败（failed, reason=stale）。只改状态，不删除任何数据。
          </p>
          <p v-if="reclaimLoading" class="vl-steps">正在扫描可回收会话…</p>
          <p v-else-if="!reclaimPreview.length" class="vl-steps vl-steps--ok">没有可回收的卡死会话。</p>
          <div v-else class="vl-reclaim-list">
            <div v-for="r in reclaimPreview" :key="r.id" class="vl-reclaim-item">
              <code class="vl-reclaim-id">{{ r.id.slice(0, 14) }}…</code>
              <span class="mk-badge mk-badge--muted">{{ r.currentStage }}</span>
              <span class="vl-reclaim-stale">{{ fmtStale(r.staleMs) }}</span>
            </div>
          </div>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="reclaimOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="reclaimBusy || !reclaimPreview.length" @click="confirmReclaim">
            {{ reclaimBusy ? '回收中…' : `确认回收 ${reclaimPreview.length} 个会话` }}
          </button>
        </div>
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
            {{ creating ? '创建中…' : '创建虚拟学习者' }}
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
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, liveCreateVirtual, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useLoadMore } from './useLoadMore'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

interface Sample {
  id: string
  name: string
  goal: string
  storyCount: number
  sessions: number
  /** 运行中会话数（live：后端全量聚合 runningCount；demo：静态演示值） */
  runningCount: number
  /** 失败/放弃会话累计数（全量聚合） */
  failedCount: number
  /** 卡死（running 超回收阈值无写入）会话数 */
  stalledCount: number
  /** 运行中会话 id（会话样本内，用于「运行中」列直达座舱） */
  runningSessionIds: string[]
  /** 最近一个运行中会话的阶段（无运行中时回退最近会话阶段） */
  currentStage: string | null
  created: string
}

const all: Sample[] = [
  { id: 'vl-001', name: '疲惫的运营小张', goal: '把 Excel 周报自动化', storyCount: 2, sessions: 4, runningCount: 1, failedCount: 0, stalledCount: 0, runningSessionIds: ['demo-s1'], currentStage: 'goal', created: '3 天前' },
  { id: 'vl-002', name: '转行的前教师', goal: '系统学数据分析', storyCount: 1, sessions: 1, runningCount: 0, failedCount: 1, stalledCount: 0, runningSessionIds: [], currentStage: null, created: '1 天前' },
  { id: 'vl-003', name: '拖延的研究生', goal: '30 天写完论文初稿', storyCount: 1, sessions: 2, runningCount: 1, failedCount: 0, stalledCount: 1, runningSessionIds: ['demo-s2'], currentStage: 'learn', created: '6 小时前' },
  { id: 'vl-004', name: '焦虑的实习产品经理', goal: '两周上手需求文档', storyCount: 0, sessions: 1, runningCount: 0, failedCount: 0, stalledCount: 0, runningSessionIds: [], currentStage: null, created: '昨天 22:10' },
  { id: 'vl-005', name: '退休学摄影的阿姨', goal: '学会手机修图', storyCount: 0, sessions: 0, runningCount: 0, failedCount: 0, stalledCount: 0, runningSessionIds: [], currentStage: null, created: '2 小时前' }
]

const demoSamples = ref<Sample[]>([...all])

const samples = computed<Sample[]>(() => {
  if (isLive.value) {
    return liveVirtuals.value.map((v) => ({
      id: v.id,
      name: v.name,
      goal: v.goal,
      storyCount: Number(v.storyCount || 0),
      sessions: v.sessions,
      runningCount: Number(v.runningCount || 0),
      failedCount: Number(v.failedCount || 0),
      stalledCount: Number(v.stalledCount || 0),
      runningSessionIds: v.runningSessionIds,
      currentStage: v.currentStage || null,
      created: timeAgo(v.createdAt)
    }))
  }
  return demoSamples.value
})

const keyword = ref('')
/** live 虚拟人域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.virtuals && !liveVirtuals.value.length
)
function retryLoad() {
  void loadLiveData()
}
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return samples.value
  return samples.value.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
})

const isFiltered = computed(() => !!keyword.value.trim())
function clearFilters() {
  keyword.value = ''
}

/* 长列表分批渲染：每批 15 行 */
const { shown, canMore, loadMore } = useLoadMore(filtered, 15)

/* 新建：人设优先（学习需求由故事产生，不在创建时必填） */
const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', story: '', aspiration: '' })
const errors = ref<{ name?: string; story?: string }>({})

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
      const createdId = await liveCreateVirtual({
        name: form.value.name.trim(),
        goal: form.value.aspiration.trim(),
        story: form.value.story.trim(),
        personaSeed: personaSeed.value || undefined
      })
      createOpen.value = false
      if (createdId) {
        toast.success('虚拟人已创建。下一步：在画像页生成故事（产生学习需求）')
        openSubPage('virtual', createdId)
      } else {
        toast.success('虚拟人已创建，但列表刷新失败——若列表未出现，请手动刷新查看')
      }
    } else {
      const id = `vl-${String(demoSamples.value.length + 1).padStart(3, '0')}`
      demoSamples.value.unshift({
        id,
        name: form.value.name.trim(),
        goal: form.value.aspiration.trim() || '—',
        storyCount: 0,
        sessions: 0,
        runningCount: 0,
        failedCount: 0,
        stalledCount: 0,
        runningSessionIds: [],
        currentStage: null,
        created: '刚刚'
      })
      createOpen.value = false
      toast.success('虚拟人已创建（演示）。下一步生成故事')
      openSubPage('virtual', id)
    }
  } catch (e) {
    toast.error(`创建失败：${errMsg(e)}`)
  } finally {
    creating.value = false
  }
}

async function removeSample(s: Sample) {
  const ok = await askConfirm({
    title: '删除虚拟学习者',
    message: `确认删除虚拟学习者「${s.name}」？\n其会话记录将一并清理，该操作不可撤销。`,
    confirmText: '删除'
  })
  if (!ok) return
  busyId.value = s.id
  try {
    await liveDeleteVirtual(s.id)
    toast.success(`「${s.name}」已删除`)
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    busyId.value = null
  }
}

/* AI 生成身份：skill:virtual-learner-persona-designer（只做人设，不依赖学习目标、不写故事） */
/** 正在删除的样本 id（ref 驱动 :disabled，computed map 出的普通对象上写 busy 不触发重渲染） */
const busyId = ref<string | null>(null)
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
      toast.error('生成失败：未返回 personaSeed')
      return
    }
    personaSeed.value = seed
    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim()
    if (nameFromSeed) form.value.name = nameFromSeed
    const background = String(seed.background || seed.corePersonality || seed.behavioralProfileSummary || '').trim()
    if (background) form.value.story = background
    toast.success('人设已回填，可改后点「创建虚拟学习者」')
  } catch (e) {
    toast.error(`生成失败：${errMsg(e)}`)
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
useEscape(() => reclaimOpen.value, () => { if (!reclaimBusy.value) reclaimOpen.value = false })

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
const reclaimOpen = ref(false)
const reclaimBusy = ref(false)
const reclaimLoading = ref(false)
const reclaimPreview = ref<ReclaimPreviewItem[]>([])
const reclaimProfileIds = ref<string[] | undefined>(undefined)
const reclaimThresholdLabel = '24 小时'

const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()
/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const launchPanelRef = ref<HTMLElement | null>(null)
const launchMaskRef = ref<HTMLElement | null>(null)
const reclaimPanelRef = ref<HTMLElement | null>(null)
const reclaimMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })
useOverlay(computed(() => !!launchTarget.value), launchPanelRef)
useMaskClose(launchMaskRef, () => { launchTarget.value = null })
useOverlay(computed(() => reclaimOpen.value), reclaimPanelRef)
useMaskClose(reclaimMaskRef, () => { if (!reclaimBusy.value) reclaimOpen.value = false })

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
    toast.error('请先在画像页生成故事；故事产生学习需求后才能运行')
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
      toast.error('该虚拟人还没有故事，请先在画像页生成')
      launchTarget.value = null
      openSubPage('virtual', s.id)
      return
    }
    if (launchStories.value.length === 1) {
      launchForm.value.storyId = launchStories.value[0].id
    }
  } catch (e) {
    toast.error(`加载故事失败：${errMsg(e)}`)
    launchTarget.value = null
  } finally {
    launchStoriesLoading.value = false
  }
}

async function startLaunch() {
  const target = launchTarget.value
  if (!target || launchBusy.value) return
  if (!launchForm.value.storyId) {
    toast.error('请选择故事；每个故事对应一套学习任务（Path）')
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
    toast.success(`已按「${storyTitle}」启动：${sid.slice(0, 14)}${sid.length > 14 ? '…' : ''}`)
    openSubPage('virtual', target.id)
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    launchBusy.value = false
  }
}

const runningTotal = computed(() => samples.value.reduce((a, s) => a + s.runningCount, 0))

/* ===== A2 生命周期分区：全量聚合口径（后端 sessionStats/staleCount），替代样本口径状态条 ===== */
const partition = computed(() => {
  if (!isLive.value) {
    return { created: 0, running: runningTotal.value, failed: 0, stale: 0 }
  }
  const st = liveVirtualSessionStats.value
  return {
    created: st.created,
    running: st.running,
    failed: st.failed + st.abandoned,
    stale: liveVirtualStaleCount.value
  }
})

/* ===== A1 批量操作：复选框 + 批量条（对齐 Users.vue 模式） ===== */
const selected = ref<string[]>([])
const batchBusy = ref(false)
const selectable = computed(() => filtered.value)
const allChecked = computed(() => selectable.value.length > 0 && selected.value.length === selectable.value.length)

function toggleAll() {
  selected.value = allChecked.value ? [] : selectable.value.map((s) => s.id)
}

/** 批量终止：对选中虚拟人全部非终态会话（运行中/创建中）标记 abandoned；只改状态不删数据 */
async function batchTerminate() {
  const ids = [...selected.value]
  if (!ids.length || batchBusy.value) return
  const runningSum = ids.reduce((a, id) => {
    const s = samples.value.find((x) => x.id === id)
    return a + (s?.runningCount ?? 0)
  }, 0)
  const ok = await askConfirm({
    title: '批量终止会话',
    message: `确认终止选中的 ${ids.length} 个虚拟学习者全部非终态会话（运行中 ${runningSum} + 创建中）？\n会话将标记为已终止（abandoned），数据保留，该操作不可撤销。`,
    confirmText: `终止 ${ids.length} 人`
  })
  if (!ok) return
  batchBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.terminateVirtualSessions({ profileIds: ids, dryRun: false })
    const d = res.data?.data ?? {}
    const terminated = Number(d.terminated ?? 0)
    const skipped = Number(d.skippedTerminal ?? 0)
    toast.success(terminated > 0 ? `已终止 ${terminated} 个会话（跳过已终态 ${skipped}）` : '没有需要终止的非终态会话')
    selected.value = []
    void loadLiveData()
  } catch (e) {
    toast.error(`批量终止失败：${errMsg(e)}`)
  } finally {
    batchBusy.value = false
  }
}

/** 批量清理卡死：对选中虚拟人调 reclaim-stale（dryRun 先展示清单再确认执行） */
function batchReclaim() {
  const ids = [...selected.value]
  if (!ids.length) return
  void openReclaimModal(ids)
}

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
interface ReclaimPreviewItem {
  id: string
  status: string
  currentStage: string
  staleMs: number
  updatedAt: string
}

async function openReclaimModal(profileIds?: string[]) {
  reclaimProfileIds.value = profileIds?.length ? [...profileIds] : undefined
  reclaimOpen.value = true
  reclaimLoading.value = true
  reclaimBusy.value = true
  reclaimPreview.value = []
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: true,
      ...(reclaimProfileIds.value ? { profileIds: reclaimProfileIds.value } : {})
    })
    const d = res.data?.data ?? {}
    reclaimPreview.value = Array.isArray(d.sessions) ? (d.sessions as ReclaimPreviewItem[]) : []
  } catch (e) {
    toast.error(`扫描卡死会话失败：${errMsg(e)}`)
    reclaimOpen.value = false
  } finally {
    reclaimLoading.value = false
    reclaimBusy.value = false
  }
}

async function confirmReclaim() {
  if (!reclaimPreview.value.length || reclaimBusy.value) return
  reclaimBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: false,
      ...(reclaimProfileIds.value ? { profileIds: reclaimProfileIds.value } : {})
    })
    const d = res.data?.data ?? {}
    toast.success(`已回收 ${Number(d.reclaimed ?? 0)} 个卡死会话（活跃租约跳过 ${Number(d.skippedActiveLease ?? 0)}）`)
    reclaimOpen.value = false
    selected.value = []
    void loadLiveData()
  } catch (e) {
    toast.error(`回收失败：${errMsg(e)}`)
  } finally {
    reclaimBusy.value = false
  }
}

function fmtStale(ms: number) {
  const mins = Math.max(1, Math.round(ms / 60000))
  if (mins < 60) return `${mins} 分钟无写入`
  return `${(mins / 60).toFixed(1)} 小时无写入`
}

/** 「运行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮） */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0]
  if (id) openSubPage('session', id)
}

/** 后端 currentStage 原文（goal/path/teaching/learn/wrapup 等）→ 中文阶段名 */
function stageLabel(stage: string | null | undefined): string {
  const s = String(stage || '').toLowerCase()
  if (s.includes('goal')) return 'Goal'
  if (s.includes('path')) return 'Path'
  if (s.includes('learn') || s.includes('teach')) return 'Learn'
  if (s.includes('wrap')) return 'Wrapup'
  return s || '—'
}
</script>

<style scoped>
.mk-link--muted { opacity: 0.55; }
.vl-row { cursor: pointer; }
/* 长期倾向列：单行截断 + title（原可换行撑高行，ADMIN_COLUMN_WIDTH_AUDIT ⑤） */
.vl-goal {
  display: block;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vl-run {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mk-faint);
  white-space: nowrap;
}
.vl-run--live {
  color: var(--mk-amber, #b7791f);
  background: rgba(217, 119, 6, 0.1);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}
.vl-run--live:hover { background: rgba(217, 119, 6, 0.18); }
.vl-run--stalled { color: var(--mk-red, #dc2626); background: rgba(220, 38, 38, 0.1); }
.vl-run--stalled:hover { background: rgba(220, 38, 38, 0.18); }
/* 失败/卡死状态标注：bad 色（对齐 mk-badge--bad） */
.vl-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
}
.vl-badge--bad { background: rgba(220, 38, 38, 0.1); color: var(--mk-red, #dc2626); }
.vl-status-run { color: var(--mk-amber, #b7791f); font-weight: 700; }
.vl-status-fail { color: var(--mk-red, #dc2626); font-weight: 700; }
.vl-status-stale { color: var(--mk-red, #dc2626); font-weight: 700; }
.vl-truncated { color: var(--mk-amber); font-weight: 700; }
.vl-status-reclaim {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.08);
  color: var(--mk-red, #dc2626);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.vl-status-reclaim:hover:not(:disabled) { background: rgba(220, 38, 38, 0.16); }
.vl-status-reclaim:disabled { opacity: 0.6; cursor: default; }
/* 批量操作条：对齐 Users.vue .ul-batch 模式（sticky 底部胶囊条） */
.vl-batch {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 0 auto;
  padding: 8px 12px 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(220, 38, 38, 0.25);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-pop);
  font-weight: 600;
  font-size: 12.5px;
}
.vl-batch__btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: transparent;
  color: var(--mk-red, #dc2626);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.vl-batch__btn:hover:not(:disabled) { background: rgba(220, 38, 38, 0.08); }
.vl-batch__btn:disabled { opacity: 0.6; cursor: default; }
.vl-batch__danger {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-red, #dc2626);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.vl-batch__danger:hover:not(:disabled) { background: var(--mk-red-strong, #b91c1c); }
.vl-batch__danger:disabled { opacity: 0.45; cursor: not-allowed; }
/* 一键回收清单 */
.vl-reclaim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 8px;
}
.vl-reclaim-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 10px;
  background: #fafbfd;
  border: 1px solid #e8ecf2;
  font-size: 12px;
}
.vl-reclaim-id { font-size: 11px; color: var(--mk-muted, #5b6577); }
.vl-reclaim-stale { margin-left: auto; color: var(--mk-red, #dc2626); font-weight: 700; white-space: nowrap; }
.vl-steps--ok { background: #e8f7ee; color: #1a7f4b; }
.vl-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}
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
  color: var(--mk-blue, #2c63d0);
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

@media (min-width: 2000px) {
  .vl-steps { font-size: 13px; padding: 9px 12px; }
  .vl-req { font-size: 12px; }
  .vl-ai-row { gap: 12px; }
  .vl-ai-hint { font-size: 12.5px; }
  .vl-persona-ok { font-size: 14px; padding: 7px 12px; }
  .vl-advanced { padding: 10px 14px; }
  .vl-advanced summary { font-size: 14px; }
  .vl-advanced[open] summary { margin-bottom: 9px; }
  .vl-batch { gap: 11px; padding: 10px 14px 10px 18px; font-size: 14px; }
  .vl-batch__btn, .vl-batch__danger { font-size: 14px; padding: 7px 16px; }
  .vl-badge { font-size: 12px; padding: 2px 10px; margin-left: 7px; }
  .vl-reclaim-item { font-size: 13.5px; padding: 8px 12px; }
  .vl-reclaim-id { font-size: 12.5px; }
  .vl-status-reclaim { font-size: 13px; padding: 6px 14px; }
}
@media (min-width: 2800px) {
  .vl-steps { font-size: 15.5px; padding: 11px 14px; }
  .vl-req { font-size: 14px; }
  .vl-ai-row { gap: 14px; }
  .vl-ai-hint { font-size: 15px; }
  .vl-persona-ok { font-size: 16.5px; padding: 8px 14px; }
  .vl-advanced { padding: 12px 17px; }
  .vl-advanced summary { font-size: 16.5px; }
  .vl-advanced[open] summary { margin-bottom: 11px; }
  .vl-batch { gap: 13px; padding: 12px 17px 12px 21px; font-size: 16.5px; }
  .vl-batch__btn, .vl-batch__danger { font-size: 16.5px; padding: 8px 19px; }
  .vl-badge { font-size: 14px; padding: 3px 12px; margin-left: 8px; }
  .vl-reclaim-item { font-size: 15.5px; padding: 9px 14px; }
  .vl-reclaim-id { font-size: 14.5px; }
  .vl-status-reclaim { font-size: 15.5px; padding: 7px 17px; }
}
</style>
