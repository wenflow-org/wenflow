<template>
  <div v-if="d" class="mk-page ud">
    <button type="button" class="ud-back" @click="closeSubPage">← 用户</button>
    <div class="ud-id">
      <span class="ud-avatar">{{ d.name.charAt(0) }}</span>
      <div>
        <h3>{{ d.name }}</h3>
        <span class="ud-sub">{{ d.email }} · {{ d.role }} · 加入 {{ d.joined }}</span>
      </div>
    </div>

    <div class="ud-stats">
      <div v-for="s in d.stats" :key="s.label" class="ud-stat">
        <span>{{ s.label }}</span>
        <strong>{{ s.value }}</strong>
      </div>
    </div>

    <div class="ud-grid">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">学习路径</h3>
        </div>
        <div class="ud-paths">
          <div v-for="p in d.recentPaths" :key="p.title" class="ud-path">
            <div class="ud-path__main">
              <strong>{{ p.title }}</strong>
              <span>{{ p.stage }}</span>
            </div>
            <div class="ud-path__bar"><i :style="{ width: p.pct + '%' }" :class="{ warn: p.tone === 'warn' }"></i></div>
            <span class="ud-path__pct">{{ p.pct }}%</span>
          </div>
          <p v-if="!d.recentPaths.length" class="ud-none">还没有路径</p>
        </div>
      </section>

      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">最近活跃</h3>
        </div>
        <div class="ud-activity">
          <div v-for="(a, i) in d.activity" :key="i" class="ud-act">
            <span>{{ a.text }}</span>
            <span class="ud-act__time">{{ a.time }}</span>
          </div>
          <p v-if="!d.activity.length" class="ud-none">暂无动态记录</p>
        </div>
      </section>
    </div>

    <!-- 开发视角许可（仅 live） -->
    <section v-if="isLive" class="mk-card ud-grant">
      <div class="mk-card__head">
        <h3 class="mk-card__title">开发视角许可</h3>
        <span class="mk-badge" :class="grantBadgeCls">{{ grantStatusLabel }}</span>
      </div>
      <p class="ud-grant__copy">
        仅当用户明确授予协助许可后，才能打开开发调试站进入该用户视角排查问题。
      </p>
      <div v-if="grantMessage" class="ud-grant__notice">{{ grantMessage }}</div>
      <div class="ud-grant__grid">
        <div><span>开放范围</span><strong>{{ grantScopeLabel }}</strong></div>
        <div><span>到期时间</span><strong>{{ grantExpiresLabel }}</strong></div>
        <div><span>协助说明</span><strong>{{ grantNoteLabel }}</strong></div>
      </div>
      <div class="ud-grant__actions">
        <button type="button" class="mk-status__action" :disabled="grantLoading" @click="loadGrant">
          {{ grantLoading ? '刷新中…' : '刷新许可' }}
        </button>
        <button
          type="button"
          class="mk-status__action mk-status__action--primary"
          :disabled="grantStatus !== 'active' || grantOpening"
          @click="openDebugStation"
        >
          {{ grantOpening ? '打开中…' : '打开开发调试站' }}
        </button>
      </div>
    </section>
  </div>

  <div v-else class="mk-page">
    <button type="button" class="ud-back" @click="closeSubPage">← 用户</button>
    <div class="mk-empty">
      <strong>{{ isLive ? '加载中…' : '该用户暂无更多演示数据' }}</strong>
      <span>{{ isLive ? '正在拉取真实用户详情' : '演示详情仅覆盖部分样本用户。' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { subPage, closeSubPage, userDetails, dataSource } from './mockStore'
import { liveUsers, liveGetUserDetail, timeAgo, errMsg } from './mockLive'
import { adminUsersApi } from '@/api/adminApi'
import { getProjectionGrantStatus, normalizeProjectionGrant, type ProjectionGrant } from '@/api/userCustom'
import { setProjectionToken } from '@/utils/projection'

interface Detail {
  name: string
  email: string
  role: string
  joined: string
  stats: { label: string; value: string }[]
  recentPaths: { title: string; stage: string; pct: number; tone: 'ok' | 'warn' }[]
  activity: { time: string; text: string }[]
}

const liveDetail = ref<Detail | null>(null)
const isLive = computed(() => dataSource.value === 'live')

const projectionGrant = ref<ProjectionGrant | null>(null)
const grantLoading = ref(false)
const grantOpening = ref(false)
const grantMessage = ref('')

const grantStatus = computed(() => getProjectionGrantStatus(projectionGrant.value))
const grantStatusLabel = computed(() => {
  if (grantStatus.value === 'active') return '已授权协助'
  if (grantStatus.value === 'expired') return '许可已过期'
  if (grantStatus.value === 'revoked') return '许可已撤销'
  return '未授权'
})
const grantBadgeCls = computed(() =>
  grantStatus.value === 'active' ? 'mk-badge--ok' : grantStatus.value === 'expired' ? 'mk-badge--warn' : 'mk-badge--muted'
)
const grantScopeLabel = computed(() =>
  projectionGrant.value?.scope === 'full' ? '完整开发视角' : projectionGrant.value ? '学习台视角' : '—'
)
const grantExpiresLabel = computed(() => {
  const t = projectionGrant.value?.expiresAt
  if (!t) return '—'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString('zh-CN', { hour12: false })
})
const grantNoteLabel = computed(() => projectionGrant.value?.note?.trim() || '用户未填写协助说明')

async function loadGrant() {
  const id = subPage.value?.id
  if (!id || !isLive.value) return
  grantLoading.value = true
  grantMessage.value = ''
  try {
    const res = await adminUsersApi.getProjectionGrant(id)
    const body = res.data?.data ?? res.data
    const list = Array.isArray(body) ? body : body?.items || body?.grants || (body ? [body] : [])
    const first = list[0] || null
    projectionGrant.value = normalizeProjectionGrant(first) || normalizeProjectionGrant(body)
    if (!projectionGrant.value) grantMessage.value = '当前还没有生效中的协助授权。'
  } catch (e) {
    projectionGrant.value = null
    grantMessage.value = `许可读取失败：${errMsg(e)}`
  } finally {
    grantLoading.value = false
  }
}

async function openDebugStation() {
  const id = subPage.value?.id
  if (!id || grantStatus.value !== 'active' || !projectionGrant.value?.id) return
  grantOpening.value = true
  try {
    const response = await adminUsersApi.createProjectionTokenFromGrant(projectionGrant.value.id, {
      scope: projectionGrant.value.scope === 'full' ? 'full' : 'dashboard',
      entry: 'dashboard'
    })
    const body = response?.data || response
    if (!body?.success && body?.data?.token == null) {
      // 兼容部分封装直接返回 data
    }
    const token = body?.data?.token || body?.token
    if (!token) throw new Error(body?.error?.message || body?.error || '投影 token 缺失')
    setProjectionToken(token, {
      userId: id,
      userName: liveDetail.value?.name,
      email: liveDetail.value?.email,
      scope: projectionGrant.value.scope === 'full' ? 'full' : 'dashboard',
      source: 'user-projection-grant'
    })
    window.open('/admin/test/dashboard', '_blank')
  } catch (e) {
    grantMessage.value = `打开失败：${errMsg(e)}`
  } finally {
    grantOpening.value = false
  }
}

watch(
  () => [subPage.value?.id, isLive.value] as const,
  async ([id, live]) => {
    liveDetail.value = null
    projectionGrant.value = null
    grantMessage.value = ''
    if (!id || !live) return
    void loadGrant()
    const base = liveUsers.value.find((u) => u.id === id)
    try {
      const raw = (await liveGetUserDetail(id)) as Record<string, unknown>
      const user = (raw.user as Record<string, unknown>) || raw
      const paths = (raw.learning_paths || raw.learningPaths || user.learning_paths || []) as Record<string, unknown>[]
      liveDetail.value = {
        name: String(user.name || base?.name || id),
        email: String(user.email || base?.email || ''),
        role: user.isAdmin || base?.isAdmin ? '管理员' : '用户',
        joined: timeAgo(String(user.createdAt || base?.createdAt || '')),
        stats: [
          { label: '路径', value: String(base?.paths ?? (paths.length || 0)) },
          { label: '会话', value: String(base?.sessions ?? 0) },
          { label: 'XP', value: String(user.xp ?? 0) },
          { label: '等级', value: String(user.currentLevel || '—') }
        ],
        recentPaths: paths.slice(0, 4).map((p) => ({
          title: String(p.title || p.goal || '未命名路径'),
          stage: String(p.status || p.current_stage || ''),
          pct: Number(p.progress ?? p.completion_rate ?? 0),
          tone: 'ok' as const
        })),
        activity: []
      }
    } catch {
      // 详情接口失败：用列表数据兜底
      if (base) {
        liveDetail.value = {
          name: base.name,
          email: base.email,
          role: base.isAdmin ? '管理员' : '用户',
          joined: timeAgo(base.createdAt),
          stats: [
            { label: '路径', value: String(base.paths) },
            { label: '会话', value: String(base.sessions) },
            { label: 'XP', value: String(base.xp) },
            { label: '等级', value: base.currentLevel || '—' }
          ],
          recentPaths: [],
          activity: []
        }
      }
    }
  },
  { immediate: true }
)

const d = computed<Detail | undefined>(() => {
  if (isLive.value) return liveDetail.value || undefined
  return userDetails.find((x) => x.id === subPage.value?.id)
})
</script>

<style scoped>
.ud { gap: 16px; }
.ud-back {
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
.ud-id { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ud-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #31b16f, #43b0d8);
  color: #fff;
  display: grid;
  place-content: center;
  font-size: 18px;
  font-weight: 800;
}
.ud-id h3 { margin: 0; font-size: 18px; }
.ud-sub { color: var(--mk-faint); font-size: 12px; }

.ud-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.ud-stat {
  display: grid;
  gap: 3px;
  padding: 13px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}
.ud-stat span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.ud-stat strong { font-size: 20px; font-variant-numeric: tabular-nums; }

.ud-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.ud-paths { display: grid; }
.ud-path {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 40px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.ud-path:last-child { border-bottom: none; }
.ud-path__main { display: grid; min-width: 0; }
.ud-path__main strong { font-size: 13px; }
.ud-path__main span { font-size: 11.5px; color: var(--mk-faint); }
.ud-path__bar { height: 6px; border-radius: 3px; background: #eef2fa; overflow: hidden; }
.ud-path__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, #3478f6); }
.ud-path__bar i.warn { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
.ud-path__pct { font-size: 12px; color: var(--mk-muted); text-align: right; font-variant-numeric: tabular-nums; }
.ud-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: 12.5px; }

.ud-activity { display: grid; }
.ud-act {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.ud-act:last-child { border-bottom: none; }
.ud-act__time { color: var(--mk-faint); font-size: 11.5px; white-space: nowrap; }

.ud-grant { margin-top: 0; }
.ud-grant__copy {
  margin: 0;
  padding: 0 16px 10px;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.6;
}
.ud-grant__notice {
  margin: 0 16px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #eef5ff;
  color: var(--mk-blue);
  font-size: 12px;
}
.ud-grant__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 0 16px 12px;
}
.ud-grant__grid div {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
  font-size: 12px;
}
.ud-grant__grid span { color: var(--mk-faint); font-weight: 700; font-size: 11px; }
.ud-grant__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 16px 16px;
}

@media (max-width: 900px) {
  .ud-stats { grid-template-columns: repeat(2, 1fr); }
  .ud-grid { grid-template-columns: 1fr; }
  .ud-grant__grid { grid-template-columns: 1fr; }
}
</style>
