<template>
  <div v-if="d" class="mk-page ud">
    <!-- 页头卡（布局重构：返回 + 身份 + 统计 合并为一行页头，对齐 HubSpot/SF record header） -->
    <header class="ud-head">
      <div class="ud-head__top">
        <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
        <div class="ud-id">
          <span class="ud-avatar">{{ d.name.charAt(0) }}</span>
          <div class="ud-id__main">
            <div class="ud-id__name-row">
              <h1 class="ud-name">{{ d.name }}</h1>
              <span v-if="isDeleted" class="mk-badge mk-badge--sm mk-badge--deleted">已删除</span>
            </div>
            <span class="ud-sub">{{ d.email }} · {{ d.role }} · 加入 {{ d.joined }}</span>
          </div>
          <div class="ud-id__actions">
            <button v-if="isDeleted" type="button" class="mk-status__action" :disabled="restoring" @click="doRestore">
              {{ restoring ? '恢复中…' : '恢复用户' }}
            </button>
            <button type="button" class="mk-status__action" @click="toLearner">查看学习者画像 →</button>
          </div>
        </div>
      </div>
      <div class="ud-kpis">
        <MkKpi v-for="s in d.stats" :key="s.label" :label="s.label" :value="s.value" />
      </div>
    </header>

    <!-- 主区双栏（左 2/3 主内容 · 右 1/3 侧栏） -->
    <div class="ud-main">
      <div class="ud-col ud-col--main">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习路径</h3>
            <span class="mk-card__meta">{{ d.recentPaths.length }} 条</span>
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
            <p v-if="!d.recentPaths.length" class="ud-none">路径明细暂不可用</p>
          </div>
        </section>
      </div>

      <div class="ud-col ud-col--side">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近活跃</h3>
            <span class="mk-card__meta">{{ d.activity.length }} 条</span>
          </div>
          <div class="ud-activity">
            <div v-for="(a, i) in d.activity" :key="i" class="ud-act">
              <span>{{ a.text }}</span>
              <span class="ud-act__time">{{ a.time }}</span>
            </div>
            <p v-if="!d.activity.length" class="ud-none">暂无动态记录</p>
          </div>
        </section>

        <!-- 开发视角许可（侧栏卡，与活跃并列） -->
        <section class="mk-card ud-grant">
          <div class="mk-card__head">
            <h3 class="mk-card__title">开发视角许可</h3>
            <span class="mk-badge" :class="grantBadgeCls">{{ grantStatusLabel }}</span>
          </div>
          <p class="ud-grant__copy">
            仅当用户明确授予协助许可后，才能打开开发调试站进入该用户视角排查问题。
          </p>
          <div v-if="grantMessage" class="ud-grant__notice" :class="grantMsgTone">{{ grantMessage }}</div>
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
              :title="grantStatus !== 'active' ? '需先授权' : undefined"
              @click="openDebugStation"
            >
              {{ grantOpening ? '打开中…' : '打开开发调试站' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>

  <div v-else-if="detailError" class="mk-page ud">
    <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
    <div class="mk-empty">
      <span class="mk-empty__icon" aria-hidden="true">◌</span>
      <strong>详情加载失败</strong>
      <span>暂时无法获取该用户的完整信息。</span>
      <button type="button" class="mk-empty__action" @click="loadDetail">重试</button>
    </div>
  </div>

  <div v-else class="mk-page ud">
    <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
    <!-- 骨架屏（P0-2：替代纯文字 loading，避免布局跳动） -->
    <div class="ud-skel" aria-hidden="true">
      <div class="ud-skel__id">
        <span class="ud-skel__avatar"></span>
        <div class="ud-skel__lines">
          <i class="ud-skel__line ud-skel__line--name"></i>
          <i class="ud-skel__line ud-skel__line--sub"></i>
        </div>
      </div>
      <div class="ud-skel__stats">
        <i v-for="n in 4" :key="n" class="ud-skel__stat"></i>
      </div>
      <div class="ud-skel__grid">
        <i v-for="n in 2" :key="n" class="ud-skel__card"></i>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { subPage, closeSubPage, openSubPage } from './store'
import MkKpi from './MkKpi.vue'
import { liveUsers, timeAgo, errMsg } from './live'
import { adminUsersApi, getUserIncludingDeleted, restoreUser } from '@/api/adminApi'
import { getProjectionGrantStatus, normalizeProjectionGrant, type ProjectionGrant } from '@/api/userCustom'
import { setProjectionToken } from '@/utils/projection'
import { toast } from '@/utils/toast'
import { askConfirm } from './useConfirm'

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
/** 等级英→中映射 */
function levelLabel(level: string | null | undefined): string {
  if (!level) return '—'
  const map: Record<string, string> = { beginner: '初学', intermediate: '进阶', advanced: '高级' }
  return map[level] || level
}
/** 详情接口失败且无列表兜底 → 明确错误态 + 重试（参照 VirtualProfile.detailError 模式） */
const detailError = ref(false)
/** Phase 2：目标为已软删账号（详情走 includeDeleted=1 放行）→ 头部展示恢复入口 */
const isDeleted = ref(false)
const restoring = ref(false)

function toLearner() {
  const id = subPage.value?.id
  // 显式包含虚拟/测试：用户详情 → 学习者画像为逐用户显式导航，不受 learner-models 默认排除影响
  if (id) openSubPage('learner', id, { includeTest: true })
}

const projectionGrant = ref<ProjectionGrant | null>(null)
const grantLoading = ref(false)
const grantOpening = ref(false)
const grantMessage = ref('')
/** 许可消息语义色：info（蓝色提示）/ error（红色错误） */
const grantMsgTone = ref('ud-grant__notice--info')

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
  if (!id) return
  grantLoading.value = true
  grantMessage.value = ''
  try {
    const res = await adminUsersApi.getProjectionGrant(id)
    const body = res.data?.data ?? res.data
    const list = Array.isArray(body) ? body : body?.items || body?.grants || (body ? [body] : [])
    const first = list[0] || null
    projectionGrant.value = normalizeProjectionGrant(first) || normalizeProjectionGrant(body)
    if (!projectionGrant.value) {
      grantMessage.value = '当前还没有生效中的协助授权。'
      grantMsgTone.value = 'ud-grant__notice--info'
    }
  } catch (e) {
    projectionGrant.value = null
    grantMessage.value = `许可读取失败：${errMsg(e)}`
    grantMsgTone.value = 'ud-grant__notice--error'
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
    window.open('/admin/console', '_blank')
  } catch (e) {
    grantMessage.value = `打开失败：${errMsg(e)}`
    grantMsgTone.value = 'ud-grant__notice--error'
  } finally {
    grantOpening.value = false
  }
}

watch(
  () => subPage.value?.id,
  () => {
    liveDetail.value = null
    projectionGrant.value = null
    grantMessage.value = ''
    detailError.value = false
    isDeleted.value = false
    const id = subPage.value?.id
    if (!id) return
    void loadDetail()
  },
  { immediate: true }
)

/** Phase 2：恢复已软删用户（身份保留策略下无需查重；成功后重拉详情，恢复入口自动消失） */
async function doRestore() {
  const id = subPage.value?.id
  if (!id || restoring.value) return
  const ok = await askConfirm({
    title: '恢复用户',
    message: `确认恢复用户「${liveDetail.value?.name || id}」？\n恢复后该用户可重新登录，历史数据原样保留。`,
    confirmText: '恢复'
  })
  if (!ok) return
  restoring.value = true
  try {
    await restoreUser(id)
    toast.success('用户已恢复，可重新登录')
    isDeleted.value = false
    void loadDetail()
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally {
    restoring.value = false
  }
}

async function loadDetail() {
  const id = subPage.value?.id
  if (!id) return
  liveDetail.value = null
  detailError.value = false
  void loadGrant()
  const base = liveUsers.value.find((u) => u.id === id)
  // 活跃明细无接口：用列表数据的最后登录/会话数合成，保证卡片有真实内容
  const activityOf = (b: typeof base) =>
    b
      ? [
          { text: `最后登录：${b.lastLoginAt ? timeAgo(String(b.lastLoginAt)) : '—'}`, time: '' },
          ...(b.sessions ? [{ text: `累计会话 ${b.sessions} 次`, time: '' }] : [])
        ]
      : []
  try {
    // 已软删账号默认被详情接口隐藏（404 语义），Phase 2 用 includeDeleted=1 放行恢复入口
    const res = await getUserIncludingDeleted(id)
    const raw = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    isDeleted.value = !!raw.deletedAt
    const user = (raw.user as Record<string, unknown>) || raw
    // 后端不返回 learning_paths 明细：路径计数用 _count 兜底，卡片显示空态（与统计条口径一致）
    const counts = (user._count as Record<string, number>) || {}
    const pathCount = Number(counts.learningPaths ?? counts.learning_paths ?? base?.paths ?? 0)
    liveDetail.value = {
      name: String(user.name || base?.name || id),
      email: String(user.email || base?.email || ''),
      role: user.isAdmin || base?.isAdmin ? '管理员' : '用户',
      joined: timeAgo(String(user.createdAt || base?.createdAt || '')),
      stats: [
        { label: '路径', value: String(base?.paths ?? pathCount) },
        { label: '会话', value: String(base?.sessions ?? 0) },
        { label: 'XP', value: String(user.xp ?? 0) },
        { label: '等级', value: levelLabel(String(user.currentLevel)) }
      ],
      recentPaths: [],
      activity: activityOf(base)
    }
  } catch {
    // 详情接口失败：用列表数据兜底；无兜底 → 明确错误态
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
          { label: '等级', value: levelLabel(base.currentLevel) }
        ],
        recentPaths: [],
        activity: activityOf(base)
      }
    } else {
      detailError.value = true
    }
  }
}

const d = computed<Detail | undefined>(() => liveDetail.value || undefined)
</script>

<style scoped>
.ud { gap: 16px; }
/* 骨架屏（P0-2）：加载中替代纯文字，避免布局跳动 */
.ud-skel { display: grid; gap: 14px; padding-top: 8px; }
.ud-skel__id { display: flex; align-items: center; gap: 14px; }
.ud-skel__avatar { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(90deg, #eef2f8 25%, #f7f9fc 50%, #eef2f8 75%); background-size: 200% 100%; animation: ud-skel-shimmer 1.2s infinite; }
.ud-skel__lines { display: grid; gap: 6px; flex: 1; max-width: 360px; }
.ud-skel__line { height: 14px; border-radius: 6px; background: linear-gradient(90deg, #eef2f8 25%, #f7f9fc 50%, #eef2f8 75%); background-size: 200% 100%; animation: ud-skel-shimmer 1.2s infinite; }
.ud-skel__line--name { width: 55%; height: 18px; }
.ud-skel__line--sub { width: 80%; height: 12px; }
.ud-skel__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ud-skel__stat { height: 64px; border-radius: 10px; background: linear-gradient(90deg, #eef2f8 25%, #f7f9fc 50%, #eef2f8 75%); background-size: 200% 100%; animation: ud-skel-shimmer 1.2s infinite; }
.ud-skel__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ud-skel__card { height: 140px; border-radius: 12px; background: linear-gradient(90deg, #eef2f8 25%, #f7f9fc 50%, #eef2f8 75%); background-size: 200% 100%; animation: ud-skel-shimmer 1.2s infinite; }
@keyframes ud-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
html[data-theme='dark'] .ud-skel__avatar, html[data-theme='dark'] .ud-skel__line, html[data-theme='dark'] .ud-skel__stat, html[data-theme='dark'] .ud-skel__card { background: linear-gradient(90deg, #1b2537 25%, #232f45 50%, #1b2537 75%); background-size: 200% 100%; }
/* 页头卡（布局重构）：返回 + 身份 + 统计合并，HubSpot/SF record header 形态 */
.ud-head {
  display: grid;
  gap: 14px;
  padding: 16px 18px 14px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}
.ud-head__top { display: flex; align-items: flex-start; gap: 12px; }
.ud-id { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.ud-id__main { display: grid; gap: 2px; min-width: 0; }
.ud-id__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ud-id__actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.ud-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #31b16f, #43b0d8);
  color: #fff;
  display: grid;
  place-content: center;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
}
.ud-id h3 { margin: 0; font-size: 18px; }
.ud-name { margin: 0; font-size: 18px; line-height: 1.4; }
.ud-sub { color: var(--mk-faint); font-size: 12px; }

/* 统计行（设计语言统一：MkKpi；页头内网格） */
.ud-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

/* 主区双栏（左 2/3 主内容 · 右 1/3 侧栏） */
.ud-main {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.ud-col { display: grid; gap: 14px; align-content: start; }
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
.ud-path__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, var(--mk-blue, #2c63d0)); }
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
.ud-grant__notice--error {
  background: var(--mk-red-bg, #fef2f2);
  color: var(--mk-red, #dc2626);
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

@media (max-width: 1100px) {
  .ud-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ud-main { grid-template-columns: 1fr; }
  .ud-grant__grid { grid-template-columns: 1fr; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ud-avatar { width: 54px; height: 54px; font-size: 21px; }
  .ud-id h3, .ud-name { font-size: 21px; }
  .ud-sub { font-size: 14px; }
  .ud-path__main strong { font-size: 15px; }
  .ud-path__main span { font-size: 13.5px; }
  .ud-path__pct { font-size: 14px; }
  .ud-none { font-size: 14.5px; }
  .ud-act { font-size: 14.5px; }
  .ud-act__time { font-size: 13.5px; }
  .ud-grant__copy { font-size: 14.5px; }
  .ud-grant__notice { font-size: 14px; }
  .ud-grant__grid div { font-size: 14px; }
  .ud-grant__grid span { font-size: 13px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号升到 2800 级（17px 级） */
  .ud-avatar { width: 62px; height: 62px; font-size: 24px; }
  .ud-id h3, .ud-name { font-size: 24.5px; }
  .ud-sub { font-size: 16.5px; }
  .ud-path__main strong { font-size: 17.5px; }
  .ud-path__main span { font-size: 16px; }
  .ud-path__pct { font-size: 16.5px; }
  .ud-none { font-size: 17px; }
  .ud-act { font-size: 17px; }
  .ud-act__time { font-size: 16px; }
  .ud-grant__copy { font-size: 17px; }
  .ud-grant__notice { font-size: 16.5px; }
  .ud-grant__grid div { font-size: 16.5px; }
  .ud-grant__grid span { font-size: 15px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .ud-avatar { width: 72px; height: 72px; font-size: 28px; }
  .ud-id h3, .ud-name { font-size: 28.5px; }
  .ud-sub { font-size: 19px; }
  .ud-path__main strong { font-size: 20.5px; }
  .ud-path__main span { font-size: 18.5px; }
  .ud-path__pct { font-size: 19px; }
  .ud-none { font-size: 20px; }
  .ud-act { font-size: 20px; }
  .ud-act__time { font-size: 18.5px; }
  .ud-grant__copy { font-size: 20px; }
  .ud-grant__notice { font-size: 19px; }
  .ud-grant__grid div { font-size: 19px; }
  .ud-grant__grid span { font-size: 17.5px; }
}
</style>
