<template>
  <div v-if="d" class="mk-page ud">
    <!-- 页头卡（T2：身份区走 .mk-entity 唯一原语） -->
    <header class="mk-entity">
      <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
      <div class="mk-entity__main">
        <span class="mk-entity__avatar mk-entity__avatar--user">{{ d.name.charAt(0) }}</span>
        <div class="mk-entity__id">
          <div class="mk-entity__name-row">
            <h1 class="mk-entity__name">{{ d.name }}</h1>
            <span v-if="isDeleted" class="mk-badge mk-badge--sm mk-badge--deleted">已删除</span>
          </div>
          <span class="mk-entity__sub">{{ d.email }} · {{ d.role }} · 加入 {{ d.joined }}<template v-if="d.lastLogin"> · 最后登录 {{ d.lastLogin }}</template></span>
        </div>
        <div class="mk-entity__actions">
          <button v-if="isDeleted" type="button" class="mk-status__action" :disabled="restoring" @click="doRestore">
            {{ restoring ? '恢复中…' : '恢复用户' }}
          </button>
          <button type="button" class="mk-btn mk-btn--primary" @click="toLearner">查看学习者画像 →</button>
        </div>
      </div>
      <div class="ud-kpis">
        <MkKpi v-for="s in d.stats" :key="s.label" :label="s.label" :value="s.value" :hint="s.hint" />
      </div>
    </header>

    <!-- 主区通栏：教学会话 / 目标对话为真实接口数据（userId 过滤），
         会话行可下钻只读座舱（session-real，带 from 记忆返回本页）。
         原「等级进度」卡与页头 XP/等级 KPI 完全重复，删；
         开发视角许可降级为一行条：未授权只留一句说明，授权才展开范围与动作。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">教学会话</h3>
        <span class="mk-card__meta">
          <MkLoading v-if="tsLoading" inline min text="加载中…" />
          <template v-else>{{ tsError ? '加载失败' : `${tsRows.length} 条` }}</template>
        </span>
      </div>
      <MkRowList :empty="!tsRows.length" :loading="tsLoading" empty-text="暂无教学会话">
        <MkRow
          v-for="s in tsRows"
          :key="s.id"
          clickable
          :title="s.topic"
          :sub="s.subText"
          :time="s.startAgo"
          @click="openSession(s.id)"
        >
          <template #lead>
            <span class="mk-badge" :class="sessBadge(s.status)">{{ statusText(s.status) || '—' }}</span>
          </template>
        </MkRow>
      </MkRowList>
    </section>

    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">目标对话</h3>
        <span class="mk-card__meta">
          <MkLoading v-if="gcLoading" inline min text="加载中…" />
          <template v-else>{{ gcError ? '加载失败' : `${gcRows.length} 条` }}</template>
        </span>
      </div>
      <MkRowList :empty="!gcRows.length" :loading="gcLoading" empty-text="暂无目标对话">
        <MkRow v-for="g in gcRows" :key="g.id" :title="g.summary" :sub="g.subText" :time="g.createdAgo">
          <template #lead>
            <span class="mk-badge" :class="stageBadgeCls(g.stage)">{{ stageText(g.stage) || '—' }}</span>
          </template>
        </MkRow>
      </MkRowList>
    </section>

    <!-- 开发视角许可：一行条（未授权 = 徽章 + 一句说明 + 刷新；授权 = 展开范围/到期与打开按钮） -->
    <section class="mk-card ud-grant">
      <div class="ud-grant__bar">
        <span class="mk-badge" :class="grantBadgeCls">开发视角许可 · {{ grantStatusLabel }}</span>
        <span class="ud-grant__meta" :title="grantStatus === 'active' ? grantNoteLabel : undefined">
          <template v-if="grantStatus === 'active'">
            {{ grantScopeLabel }}<template v-if="projectionGrant?.expiresAt"> · 至 {{ grantExpiresLabel }}</template><template v-if="projectionTokenExpiryLabel"> · {{ projectionTokenExpiryLabel }}</template>
          </template>
          <template v-else>用户授予协助许可后，可打开开发调试站进入其视角排查问题</template>
        </span>
        <span class="ud-grant__bar-actions">
          <button type="button" class="mk-status__action" :disabled="grantLoading" @click="loadGrant">
            {{ grantLoading ? '刷新中…' : '刷新' }}
          </button>
          <button
            v-if="grantStatus === 'active'"
            type="button"
            class="mk-status__action mk-status__action--primary"
            :disabled="grantOpening"
            @click="openDebugStation"
          >
            {{ grantOpening ? '打开中…' : '打开开发调试站' }}
          </button>
        </span>
      </div>
      <div v-if="grantMsgTone === 'ud-grant__notice--error'" class="ud-grant__notice ud-grant__notice--error">{{ grantMessage }}</div>
    </section>
  </div>

  <div v-else-if="detailError" class="mk-page ud">
    <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
    <MkEmptyState
      icon="◌"
      tone="error"
      title="详情加载失败"
      :description="detailErrorMsg || '暂时无法获取该用户的完整信息。'"
      action-text="重试"
      @action="loadDetail"
    />
  </div>

  <div v-else class="mk-page ud">
    <button type="button" class="mk-back" @click="closeSubPage">← 用户</button>
    <!-- 骨架屏（P0-2：替代纯文字 loading，避免布局跳动）。形状走 MkSkeleton 版式。 -->
    <div class="ud-skel" aria-hidden="true">
      <MkSkeleton variant="identity" :avatar="48" />
      <MkSkeleton variant="cards" :count="4" :h="64" :cols="4" :radius="10" />
      <MkSkeleton variant="cards" :count="2" :h="140" :cols="2" :radius="12" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { subPage, closeSubPage, openSubPage } from './store'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkRowList from '@/components/mk/MkRowList.vue'
import MkRow from '@/components/mk/MkRow.vue'
import { liveUsers, timeAgo, errMsg } from './live'
import { adminUsersApi, adminTeachingSessionsApi, adminGoalConversationsApi, getUserIncludingDeleted, restoreUser } from '@/api/adminApi'
import { statusText, stageText, stageBadgeCls } from './statusText'
import { getProjectionGrantStatus, normalizeProjectionGrant, type ProjectionGrant } from '@/api/userCustom'
import { clearProjectionToken, setProjectionToken } from '@/utils/projection'
import { toast } from '@/utils/toast'
import { askConfirm } from './useConfirm'

interface Detail {
  name: string
  email: string
  role: string
  joined: string
  /** 最后登录（仅列表兜底数据有；详情接口不回该字段） */
  lastLogin: string
  stats: { label: string; value: string; hint?: string }[]
}

const liveDetail = ref<Detail | null>(null)
/** 等级英→中映射 */

/** XP 项的升级语境（批E，公式与后端 level.util.ts 同源） */
function xpHintOf(xp: number): string {
  const n = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
  const toNext = Math.max(100 * n * n - xp, 0)
  return toNext > 0 ? `距 L${n + 1} 还需 ${toNext} XP` : '已达最高档'
}
function levelLabel(level: string | null | undefined): string {
  if (!level) return '—'
  const map: Record<string, string> = { beginner: '初学', intermediate: '进阶', advanced: '高级' }
  return map[level] || level
}

// ===== 用户维度活动数据（教学会话 / 目标对话，真实接口 userId 过滤） =====
interface SessionRow {
  id: string
  topic: string
  subText: string
  status: string
  startAgo: string
}
interface GoalRow {
  id: string
  stage: string
  summary: string
  subText: string
  createdAgo: string
}
const tsRows = ref<SessionRow[]>([])
const gcRows = ref<GoalRow[]>([])
const tsLoading = ref(false)
const gcLoading = ref(false)
const tsError = ref(false)
const gcError = ref(false)

/** 状态徽章降噪（对齐 TeachingSessions.statusBadge）：仅异常态上色，正常态灰 */
const sessBadge = (s: string) =>
  s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed'
    ? 'mk-badge--bad'
    : s === 'superseded'
      ? 'mk-badge--warn'
      : 'mk-badge--muted'

/** goal 摘要（对齐 GoalConversations.summaryOf：description 优先，兜底解析 collectedData） */
function goalSummaryOf(c: Record<string, unknown>): string {
  if (c.description) return String(c.description)
  try {
    const cd = JSON.parse(String(c.collectedData || '{}'))
    return String(cd.goal || cd.learningGoal || cd.objective || cd.target || '—')
  } catch {
    return '—'
  }
}

async function loadActivity(id: string) {
  tsLoading.value = true
  tsError.value = false
  gcLoading.value = true
  gcError.value = false
  const ts = adminTeachingSessionsApi
    .list({ userId: id, limit: 5, includeTest: true })
    .then((res) => {
      if (subPage.value?.id !== id) return
      const body = res.data?.data ?? res.data ?? {}
      tsRows.value = ((body.items as Record<string, unknown>[]) || []).map((s) => {
        const dur = Number(s.duration || 0)
        const durationText = dur >= 60 ? `${Math.round(dur / 60)} 分钟` : dur > 0 ? `${dur} 秒` : ''
        return {
          id: String(s.id),
          topic: String(s.topic || s.taskId || '未命名会话'),
          subText: `${String(s.subject || '—')} · ${Number(s.messageCount || 0)} 条消息${durationText ? ` · 时长 ${durationText}` : ''}`,
          status: String(s.status || ''),
          startAgo: timeAgo(String(s.startTime || ''))
        }
      })
    })
    .catch(() => {
      if (subPage.value?.id === id) tsError.value = true
    })
    .finally(() => {
      if (subPage.value?.id === id) tsLoading.value = false
    })
  const gc = adminGoalConversationsApi
    .list({ userId: id, limit: 4, includeTest: true })
    .then((res) => {
      if (subPage.value?.id !== id) return
      const body = res.data?.data ?? res.data ?? {}
      gcRows.value = ((body.conversations as Record<string, unknown>[]) || []).map((c) => ({
        id: String(c.id),
        stage: String(c.stage || ''),
        summary: goalSummaryOf(c),
        subText: `${statusText(String(c.status || '')) || '—'}${c.learningPathId ? ' · 已生成学习路径' : ''}`,
        createdAgo: timeAgo(String(c.createdAt || ''))
      }))
    })
    .catch(() => {
      if (subPage.value?.id === id) gcError.value = true
    })
    .finally(() => {
      if (subPage.value?.id === id) gcLoading.value = false
    })
  await Promise.all([ts, gc])
}

/** 会话行 → 真实会话只读座舱（座舱仅服务虚拟会话，真实会话走 session-real）；
    from 记忆来源，座舱返回时回到本用户详情 */
function openSession(sessionId: string) {
  const sp = subPage.value
  openSubPage('session-real', sessionId, sp ? { from: { view: sp.view, id: sp.id, label: sp.label } } : undefined)
}
/** 详情接口失败且无列表兜底 → 明确错误态 + 重试（参照 VirtualProfile.detailError 模式） */
const detailError = ref(false)
/** 错误文案：区分「用户不存在/已删除」(404) 与网络/服务异常 */
const detailErrorMsg = ref('')
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

// ===== 投影 token（冒充用户）的本地生命周期 =====
// 为什么：投影 token 与管理员自身凭据同存 localStorage 且此前无过期清理，
// 残留即等于一个 30 分钟的冒充窗口。后端签发响应只有 tokenExpiresIn: '30m'
// 字符串（无绝对过期时间戳），故过期时刻按「签发时刻 + 30 分钟」本地记账；
// 若服务端将来返回绝对过期字段则优先采用。
const PROJECTION_TOKEN_TTL_MS = 30 * 60 * 1000
const PROJECTION_TOKEN_EXPIRES_KEY = 'projection_token_expires_at'
/** 当前本地投影 token 的过期时刻（ms）；null = 本地无有效记录 */
const projectionTokenExpiresAt = ref<number | null>(null)

/** 有效期展示：过期后由轮询清键置 null，该行随之消失 */
const projectionTokenExpiryLabel = computed(() => {
  const exp = projectionTokenExpiresAt.value
  if (exp == null || Date.now() >= exp) return ''
  const hhmm = new Date(exp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  return `token 有效期至 ${hhmm}（30 分钟）`
})

/** 过期即清两个键：不清理的话，过期 token 会一直躺在同源存储里冒充凭据可被复用 */
function purgeExpiredProjectionToken() {
  let exp = projectionTokenExpiresAt.value
  if (exp == null) {
    // ref 为空时以 localStorage 为准（覆盖其他页签/上次会话留下的残留）
    const raw = Number(localStorage.getItem(PROJECTION_TOKEN_EXPIRES_KEY))
    if (!Number.isFinite(raw) || raw <= 0) return
    exp = raw
    projectionTokenExpiresAt.value = raw
  }
  if (Date.now() < exp) return
  clearProjectionToken() // token + context（utils 已封装）
  localStorage.removeItem(PROJECTION_TOKEN_EXPIRES_KEY)
  projectionTokenExpiresAt.value = null
  // 刚跨过过期线：重拉许可，卡片与按钮态（grantStatus）回到真实状态
  if (subPage.value?.id) void loadGrant()
}

/** 挂载即清一次 + 每 60s 轮询：其他页签的残留也要在回到本页时被清掉 */
let projectionExpiryTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  purgeExpiredProjectionToken()
  projectionExpiryTimer = setInterval(purgeExpiredProjectionToken, 60_000)
})
onBeforeUnmount(() => {
  if (projectionExpiryTimer) clearInterval(projectionExpiryTimer)
})

async function loadGrant() {
  const id = subPage.value?.id
  if (!id) return
  grantLoading.value = true
  grantMessage.value = ''
  try {
    const res = await adminUsersApi.getProjectionGrant(id)
    // 竞态守卫：await 期间用户已切到别的用户，丢弃本响应
    if (subPage.value?.id !== id) return
    const body = res.data?.data ?? res.data
    const list = Array.isArray(body) ? body : body?.items || body?.grants || (body ? [body] : [])
    const first = list[0] || null
    projectionGrant.value = normalizeProjectionGrant(first) || normalizeProjectionGrant(body)
    if (!projectionGrant.value) {
      grantMessage.value = '当前还没有生效中的协助授权。'
      grantMsgTone.value = 'ud-grant__notice--info'
    }
  } catch (e) {
    // 竞态守卫（回归 R2）：catch 侧同样要比对 id——await 期间已切到别的用户时，
    // 旧用户的失败结果不能写到新用户页面（try 侧守卫只覆盖成功路径）
    if (subPage.value?.id !== id) return
    projectionGrant.value = null
    grantMessage.value = `许可读取失败：${errMsg(e)}`
    grantMsgTone.value = 'ud-grant__notice--error'
  } finally {
    // loading 复位也要带守卫：新用户请求已在途时，旧请求的 finally 不能提前关掉它的 loading
    if (subPage.value?.id === id) grantLoading.value = false
  }
}

async function openDebugStation() {
  const id = subPage.value?.id
  if (!id || grantStatus.value !== 'active' || !projectionGrant.value?.id) return
  // 打开前先校验并清掉过期残留：本地不留已被服务端拒收的旧 token（本次会重新签发）
  purgeExpiredProjectionToken()
  grantOpening.value = true
  try {
    const response = await adminUsersApi.createProjectionTokenFromGrant(projectionGrant.value.id, {
      scope: projectionGrant.value.scope === 'full' ? 'full' : 'dashboard',
      entry: 'dashboard'
    })
    const body = response?.data || response
    const token = body?.data?.token || body?.token
    if (!token) throw new Error(body?.error?.message || body?.error || '投影 token 缺失')
    // 过期时刻：优先取服务端绝对时间；当前后端只回 tokenExpiresIn: '30m'，
    // 故兜底为签发时刻 + 30 分钟（与后端 30min 签发窗口一致）
    const serverExp = body?.data?.expiresAt ?? body?.data?.tokenExpiresAt
    const parsedServerExp = serverExp != null ? new Date(serverExp).getTime() : NaN
    const expiresAt = Number.isFinite(parsedServerExp) ? parsedServerExp : Date.now() + PROJECTION_TOKEN_TTL_MS
    setProjectionToken(token, {
      userId: id,
      userName: liveDetail.value?.name,
      email: liveDetail.value?.email,
      scope: projectionGrant.value.scope === 'full' ? 'full' : 'dashboard',
      source: 'user-projection-grant'
    })
    // 与 token 同步落过期时刻：先有 token 后有期限，避免出现无法清理的孤儿 token
    localStorage.setItem(PROJECTION_TOKEN_EXPIRES_KEY, String(expiresAt))
    projectionTokenExpiresAt.value = expiresAt
    window.open('/admin/console', '_blank')
  } catch (e) {
    grantMessage.value = `打开失败：${errMsg(e)}`
    grantMsgTone.value = 'ud-grant__notice--error'
  } finally {
    grantOpening.value = false
  }
}

/** 加载序号：详情在两个用户间快速切换时，旧请求后到会覆盖新数据——last-wins 守卫。
    必须声明在下方 watch 之前：watch 带 immediate，深链挂载（subPage 已设）时会在
    setup 期间同步调用 loadDetail，声明在后会撞 TDZ（ReferenceError），请求永不发出 */
let detailLoadSeq = 0

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
    confirmText: '恢复',
    danger: false
  })
  if (!ok) return
  restoring.value = true
  try {
    await restoreUser(id)
    // 竞态守卫：恢复期间用户已切到别的用户，不再改写当前详情状态
    if (subPage.value?.id !== id) return
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
  const seq = ++detailLoadSeq
  liveDetail.value = null
  detailError.value = false
  detailErrorMsg.value = ''
  void loadGrant()
  tsRows.value = []
  gcRows.value = []
  void loadActivity(id)
  const base = liveUsers.value.find((u) => u.id === id)
  try {
    // 已软删账号默认被详情接口隐藏（404 语义），Phase 2 用 includeDeleted=1 放行恢复入口
    const res = await getUserIncludingDeleted(id)
    // 竞态守卫：await 期间用户已切走或触发了更新的加载，丢弃本响应
    if (seq !== detailLoadSeq || subPage.value?.id !== id) return
    const raw = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    isDeleted.value = !!raw.deletedAt
    const user = (raw.user as Record<string, unknown>) || raw
    // 后端不返回 learning_paths 明细：路径计数用 _count 兜底，与统计条口径一致
    const counts = (user._count as Record<string, number>) || {}
    const pathCount = Number(counts.learningPaths ?? counts.learning_paths ?? base?.paths ?? 0)
    liveDetail.value = {
      name: String(user.name || base?.name || id),
      email: String(user.email || base?.email || ''),
      role: user.isAdmin || base?.isAdmin ? '管理员' : '用户',
      joined: timeAgo(String(user.createdAt || base?.createdAt || '')),
      lastLogin: base?.lastLoginAt ? timeAgo(String(base.lastLoginAt)) : '',
      stats: [
        { label: '路径', value: String(base?.paths ?? pathCount) },
        // 列表兜底缺失时不臆造 0：无数据显示 '—'
        { label: '会话', value: base?.sessions != null ? String(base.sessions) : '—' },
        { label: 'XP', value: String(user.xp ?? 0), hint: xpHintOf(Number(user.xp ?? 0)) },
        { label: '等级', value: levelLabel(String(user.currentLevel)), hint: '按 XP 推导' }
      ]
    }
  } catch (e) {
    if (seq !== detailLoadSeq || subPage.value?.id !== id) return
    // 详情接口失败：用列表数据兜底；无兜底 → 明确错误态
    if (base) {
      liveDetail.value = {
        name: base.name,
        email: base.email,
        role: base.isAdmin ? '管理员' : '用户',
        joined: timeAgo(base.createdAt),
        lastLogin: base.lastLoginAt ? timeAgo(String(base.lastLoginAt)) : '',
        stats: [
          { label: '路径', value: String(base.paths) },
          { label: '会话', value: String(base.sessions) },
          { label: 'XP', value: String(base.xp), hint: xpHintOf(Number(base.xp)) },
          { label: '等级', value: levelLabel(base.currentLevel), hint: '按 XP 推导' }
        ]
      }
    } else {
      // 404 = 用户不存在/已删除（includeDeleted 也未放行），与网络/服务异常区分开
      const status = (e as { response?: { status?: number } })?.response?.status
      detailErrorMsg.value =
        status === 404 ? '该用户不存在或已被删除。' : '网络异常，暂时无法获取该用户的完整信息。'
      detailError.value = true
    }
  }
}

const d = computed<Detail | undefined>(() => liveDetail.value || undefined)
</script>

<style scoped>
.ud { gap: 16px; }
/* 骨架屏（P0-2）：加载中替代纯文字，避免布局跳动 */
/* 骨架形状（shimmer 视觉统一走 .mk-skeleton） */
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.ud-skel { display: grid; gap: 14px; padding-top: 8px; }
/* 页头身份区走 .mk-entity（shared.css）；本页只保留页头内的统计行 */
/* 统计行（设计语言统一：MkKpi；页头内网格） */
.ud-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

/* 主区通栏：卡片直接入 .ud 网格堆叠（原双栏右列与 KPI 重复，已删） */
/* 行式列表已统一为全局原语 MkRowList/MkRow（components/mk），本页不再私有行样式 */

/* 开发视角许可：一行条（未授权 = 徽章 + 一句说明；授权才展开范围与打开按钮） */
.ud-grant__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
}
.ud-grant__meta {
  flex: 1;
  min-width: 0;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ud-grant__bar-actions { display: flex; gap: 8px; margin-left: auto; }
.ud-grant__notice {
  margin: 0 16px 10px;
  padding: 8px 10px;
  border-radius: var(--mk-radius-sm);
  /* 走 token：浅色 #eff6ff、暗色 rgba(91,141,239,.16)，避免暗色下仍是白底（原硬编码 #eef5ff） */
  background: var(--mk-blue-bg, #eff6ff);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
}
.ud-grant__notice--error {
  background: var(--mk-red-bg, #fef2f2);
  color: var(--mk-red, #dc2626);
}

@media (max-width: 1100px) {
  .ud-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ud-grant__meta { font-size: var(--mk-fs-body); }
  .ud-grant__notice { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号升到 2800 级（17px 级） */
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ud-grant__meta { font-size: var(--mk-fs-body); }
  .ud-grant__notice { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .mk-row__sub { font-size: var(--mk-fs-emphasis); }
  .ud-grant__meta { font-size: var(--mk-fs-emphasis); }
  .ud-grant__notice { font-size: var(--mk-fs-emphasis); }
}
</style>
