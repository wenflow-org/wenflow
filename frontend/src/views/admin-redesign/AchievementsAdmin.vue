<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">成就管理</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">成就定义 {{ defs.length }}</span>
      <span class="mk-status__meta">解锁记录 {{ totalRecords }}</span>
      <span class="mk-pills" style="margin-left: auto">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'defs' }" @click="switchTab('defs')">成就定义</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'records' }" @click="switchTab('records')">解锁记录</button>
      </span>
    </div>

    <!-- 成就定义 Tab -->
    <div v-if="tab === 'defs'" class="mk-card">
      <MockSkeletonTable v-if="defsLoading && !defs.length" :cols="5" />
      <div v-else-if="defs.length" class="mk-table-scroll ac-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>成就</th>
              <th>类型</th>
              <th>条件</th>
              <th class="mk-col--num">XP</th>
              <th class="mk-col--num">已解锁</th>
              <th class="mk-col--actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in defs" :key="d.id">
              <td>
                <div class="mk-cell-main">
                  <strong><span class="ac-icon">{{ d.icon }}</span> {{ d.name }}</strong>
                  <span class="mk-cell-sub">{{ d.description }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="typeBadge(d.type)">{{ typeText(d.type) }}</span></td>
              <td class="mk-cell-text">{{ reqText(d.requirement) }}</td>
              <td class="mk-num">+{{ d.xpReward }}</td>
              <td class="mk-num">{{ d.unlockCount }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openGrant(d)">手动发放</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="defsFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>成就定义加载失败</strong>
        <button type="button" class="mk-empty__action" @click="loadDefs">重试</button>
      </div>
    </div>

    <!-- 解锁记录 Tab -->
    <div v-else class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="ac-filter">
          <input v-model="recordSearch" class="mk-filter__input" placeholder="搜索用户姓名 / 邮箱…" @keydown.enter="reloadRecords" />
          <button type="button" class="mk-btn mk-btn--sm" @click="reloadRecords">查询</button>
        </div>
        <label class="mk-field--switch">
          <input v-model="includeTest" type="checkbox" @change="reloadRecords" />
          <span class="mk-field__label" style="margin:0">含虚拟/测试</span>
        </label>
      </div>
      <MockSkeletonTable v-if="recordsLoading && !records.length" :cols="6" />
      <div v-else-if="records.length" class="mk-table-scroll ac-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>成就</th>
              <th>用户</th>
              <th>类型</th>
              <th class="mk-col--num">XP</th>
              <th class="mk-col--time-full">解锁时间</th>
              <th class="mk-col--actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>
                <div class="mk-cell-main">
                  <strong><span class="ac-icon">{{ r.iconUrl || '🏆' }}</span> {{ r.title }}</strong>
                  <span class="mk-cell-sub" :title="r.description || ''">{{ r.description || '' }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong>
                    {{ r.user?.name || '—' }}
                    <span v-if="r.user?.isVirtualLearner" class="mk-badge mk-badge--virtual">虚拟</span>
                  </strong>
                  <span class="mk-cell-sub">{{ r.user?.email || r.userId }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="typeBadge(r.type)">{{ typeText(r.type) }}</span></td>
              <td class="mk-num">+{{ r.xpReward }}</td>
              <td :title="fmtDate(r.earnedAt)">{{ timeAgo(r.earnedAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link mk-link--danger" :disabled="r.busy" @click="revoke(r)">撤回</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="recordsFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>解锁记录加载失败</strong>
        <button type="button" class="mk-empty__action" @click="reloadRecords">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>还没有解锁记录</strong>
        <span>用户完成任务、连续学习、达成里程碑后自动解锁，也可在「成就定义」手动发放。</span>
      </div>
      <Pagination
        v-if="totalRecords > pageSize"
        v-model:page="recordPage"
        :total="totalRecords"
        :page-size="pageSize"
        :loading="recordsLoading"
        show-total
        @update:page="reloadRecords"
      />
    </div>

    <!-- 手动发放弹窗 -->
    <Teleport to="body">
      <div v-if="grantOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="手动发放成就">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">手动发放成就</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="grantOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <div class="mk-field">
              <span class="mk-field__label">成就</span>
              <div class="ac-grant-target">
                <span class="ac-icon ac-icon--lg">{{ grantTarget?.icon }}</span>
                <div>
                  <strong>{{ grantTarget?.name }}</strong>
                  <span class="mk-cell-sub">{{ grantTarget?.description }}</span>
                </div>
                <span class="mk-badge mk-badge--ok">+{{ grantTarget?.xpReward }} XP</span>
              </div>
            </div>
            <label class="mk-field" :class="{ 'mk-field--error': errors.user }">
              <span class="mk-field__label">用户</span>
              <input v-model="grantSearch" class="mk-field__input" placeholder="搜索姓名 / 邮箱（至少 2 字符）…" @input="searchGrantUser" />
              <span v-if="errors.user" class="mk-field__err">{{ errors.user }}</span>
            </label>
            <div v-if="grantResults.length" class="ac-candidates">
              <button
                v-for="u in grantResults"
                :key="u.id"
                type="button"
                class="ac-candidate"
                :class="{ 'ac-candidate--on': grantUserId === u.id }"
                @click="grantUserId = u.id"
              >
                <strong>{{ u.name || u.email }}</strong>
                <span class="mk-cell-sub">{{ u.email }}</span>
              </button>
            </div>
            <p v-else-if="grantSearched" class="ac-none">没有匹配用户</p>
            <div v-if="grantError" class="errorbar">{{ grantError }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="grantOpen = false">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="!grantUserId || granting" @click="confirmGrant">
              {{ granting ? '发放中…' : '确认发放（+XP）' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg } from './live'
import { adminAchievementsApi, type AchievementDef, type AchievementRecord } from '@/api/adminApi'
import { adminUsersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'

const tab = ref<'defs' | 'records'>('defs')
const statusTone = computed(() => 'mk-status--ok')

/* 定义 */
const defs = ref<AchievementDef[]>([])
const defsLoading = ref(false)
const defsFailed = ref(false)

const typeText = (t: string) => ({ milestone: '里程碑', streak: '连续', completion: '完成度', mastery: '掌握', social: '社交' }[t] || t)
const typeBadge = (t: string) =>
  t === 'milestone' ? 'mk-badge--info' : t === 'streak' ? 'mk-badge--warn' : t === 'completion' ? 'mk-badge--ok' : t === 'mastery' ? 'mk-badge--bad' : 'mk-badge--muted'
const reqText = (r: AchievementDef['requirement']) => {
  const t = r.type
  if (t === 'task_count') return `完成 ${r.value} 个任务`
  if (t === 'streak_days') return `连续学习 ${r.value} 天`
  if (t === 'path_completion') return `完成 ${r.value} 条路径`
  if (t === 'ktl_level') return `KTL 达到 ${r.value}`
  return `自定义条件`
}

async function loadDefs() {
  defsLoading.value = true
  defsFailed.value = false
  try {
    const res = await adminAchievementsApi.getDefinitions()
    defs.value = (res.data?.data ?? res.data) || []
  } catch (e) {
    defsFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    defsLoading.value = false
  }
}

/* 记录 */
const records = ref<Array<AchievementRecord & { busy?: boolean }>>([])
const totalRecords = ref(0)
const recordPage = ref(1)
const pageSize = ref(20)
const recordsLoading = ref(false)
const recordsFailed = ref(false)
const recordSearch = ref('')
const includeTest = ref(false)

async function reloadRecords() {
  recordsLoading.value = true
  recordsFailed.value = false
  try {
    const res = await adminAchievementsApi.getRecords({
      page: recordPage.value,
      limit: pageSize.value,
      userId: recordSearch.value.trim() || undefined,
      includeTest: includeTest.value || undefined,
    })
    const body = res.data?.data ?? res.data ?? {}
    records.value = (body.records || []).map((r) => ({ ...r, busy: false }))
    totalRecords.value = body.pagination?.total ?? records.value.length
  } catch (e) {
    recordsFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    recordsLoading.value = false
  }
}

/* 撤回 */
async function revoke(r: AchievementRecord & { busy?: boolean }) {
  const ok = await askConfirm({
    title: '撤回成就',
    message: `确认撤回「${r.title}」（${r.user?.name || '未知用户'}）？\n将扣回 ${r.xpReward} XP。`,
    confirmText: '撤回',
  })
  if (!ok) return
  r.busy = true
  try {
    await adminAchievementsApi.revoke(r.id)
    records.value = records.value.filter((x) => x.id !== r.id)
    totalRecords.value = Math.max(0, totalRecords.value - 1)
    toast.success('成就已撤回')
  } catch (e) {
    toast.error(`撤回失败：${errMsg(e)}`)
  } finally {
    r.busy = false
  }
}

/* 发放 */
const grantOpen = ref(false)
useEscape(() => grantOpen.value, () => { grantOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => grantOpen.value), panelRef)
useMaskClose(maskRef, () => { grantOpen.value = false })

const grantTarget = ref<AchievementDef | null>(null)
const grantSearch = ref('')
const grantResults = ref<Array<{ id: string; name: string; email: string }>>([])
const grantSearched = ref(false)
const grantUserId = ref('')
const granting = ref(false)
const grantError = ref('')
const errors = ref<{ user?: string }>({})

function openGrant(d: AchievementDef) {
  grantTarget.value = d
  grantSearch.value = ''
  grantResults.value = []
  grantSearched.value = false
  grantUserId.value = ''
  grantError.value = ''
  errors.value = {}
  grantOpen.value = true
}

let grantTimer: ReturnType<typeof setTimeout> | undefined
function searchGrantUser() {
  clearTimeout(grantTimer)
  const q = grantSearch.value.trim()
  if (q.length < 2) {
    grantResults.value = []
    grantSearched.value = false
    return
  }
  grantTimer = setTimeout(async () => {
    try {
      const res = await adminUsersApi.getUsers({ page: 1, limit: 8, search: q })
      const body = res.data?.data ?? res.data ?? {}
      const items = body.users || body.items || []
      grantResults.value = items.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
      }))
      grantSearched.value = true
    } catch {
      grantResults.value = []
      grantSearched.value = true
    }
  }, 300)
}

async function confirmGrant() {
  if (!grantUserId.value || !grantTarget.value) { errors.value.user = '请选择用户'; return }
  granting.value = true
  grantError.value = ''
  try {
    await adminAchievementsApi.grant(grantUserId.value, grantTarget.value.id)
    grantOpen.value = false
    toast.success(`已向用户发放「${grantTarget.value.name}」（+${grantTarget.value.xpReward} XP）`)
    void loadDefs()
    if (tab.value === 'records') void reloadRecords()
  } catch (e) {
    grantError.value = errMsg(e)
  } finally {
    granting.value = false
  }
}

function switchTab(t: 'defs' | 'records') {
  tab.value = t
  if (t === 'records' && !records.value.length && !recordsLoading.value) void reloadRecords()
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

void loadDefs()
</script>

<style scoped>
.ac-list { min-height: var(--mk-empty-min-h, calc(100dvh - 230px)); }
.ac-icon { margin-right: 4px; }
.ac-icon--lg { font-size: 22px; margin-right: 10px; }

.ac-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ac-filter .mk-filter__input { min-width: 240px; }

.ac-grant-target {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #fafbfc;
}
.ac-grant-target > div { flex: 1; display: grid; gap: 1px; min-width: 0; }
.ac-grant-target strong { font-size: 13px; }

.ac-candidates { display: grid; gap: 6px; max-height: 220px; overflow-y: auto; }
.ac-candidate {
  display: grid;
  gap: 1px;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.ac-candidate:hover { border-color: rgba(44, 99, 208, 0.4); }
.ac-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.12); }
.ac-candidate strong { font-size: 12.5px; }
.ac-none { color: var(--mk-faint); font-size: 12.5px; text-align: center; padding: 10px 0; }

.errorbar {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg, #fef2f2);
  color: var(--mk-red, #dc2626);
  font-size: 12.5px;
  font-weight: 600;
}
</style>
