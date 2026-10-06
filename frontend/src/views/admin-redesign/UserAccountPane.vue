<template>
  <div v-if="d" class="ud-root">
    <!-- 账号头（pane 内联）：状态徽章 + 危险/恢复动作。合并进 LearnerDetail 后
         本组件不再是整页（hero 归宿主），账号轴的状态与危险操作就地承载 -->
    <div class="ud-head">
      <span class="mk-badge" :class="isDeleted ? 'mk-badge--deleted' : 'mk-badge--ok'">
        {{ isDeleted ? '已删除' : '正常' }}
      </span>
      <span class="ud-head__sp"></span>
      <button v-if="isDeleted" type="button" class="mk-btn" :disabled="restoring" @click="doRestore">
        {{ restoring ? '恢复中…' : '恢复用户' }}
      </button>
      <div v-if="canDelete" class="mk-menu">
        <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu('hero')">⋯</button>
        <div v-if="openMenu === 'hero'" class="mk-menu__pop" :style="popStyle" @click.stop>
          <button type="button" class="mk-menu__item mk-menu__item--danger" title="软删除：禁止登录，历史数据保留，可在用户列表恢复" @click="menuDelete">删除账户…</button>
        </div>
      </div>
    </div>
    <!-- 状态条（原型 renderLearnerDetail 的 statstrip：hero 与 subtabs 之间的一行四格读数，
         一张卡通栏分格，非 KPI 卡栅格——LearnerDetail 同款模板）。
         2026-10-05（批次五 CM2）：本地 .statstrip 复刻退役，改用共享 MkStatStrip 的 grid 变体。 -->
    <section class="mk-card">
      <MkStatStrip layout="grid" aria-label="账号概览" :items="accountStatItems" />
      <!-- P2（2026-10-04 全站评审）：原 P1#15「学习状态」格撤——趋势/疲劳/置信三事实同屏
           已由 hero pills 逐项承载，格内是原样复读；学习轴读数也已随页级 statstrip
           在本页签下不渲染（LearnerDetail）而归位各页签 -->
    </section>

    <!-- 主卡（原型 renderLearnerDetail 主区结构）：subtabs 置卡顶、pane 在同一张卡内，
         默认页签=概览。此前页签裸置页 + 每页签独立卡，与原型「一张卡承载全部分区」的
         详情页设计不一致（2026-10-02 用户指正「和新UI的详情页设计不一样」）。 -->
      <!-- 概览（默认页签，原型 overview 卡网格）：账户信息 kv（hero 副文会截断，这里给全量字段）
           + 最近活动 feed（教学会话与目标对话按时间合并，行可下钻只读座舱） -->
      <div class="ud-pane ud-ov">
        <section class="mk-card">
          <div class="mk-card__head"><h3 class="mk-card__title">账户信息</h3></div>
          <dl class="ud-kv">
            <dt>邮箱</dt><dd :title="d.email">{{ d.email }}</dd>
            <dt>角色</dt><dd>{{ d.role }}</dd>
            <dt>加入时间</dt><dd :title="d.joinedAbs || undefined">{{ d.joined || '—' }}</dd>
            <dt>最后登录</dt><dd :title="d.lastLoginAbs || undefined">{{ d.lastLogin || '—' }}</dd>
          </dl>
        </section>
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近活动</h3>
            <span class="mk-card__meta">会话 + 目标 · 最近 {{ feedRows.length }} 条</span>
          </div>
          <div v-if="feedRows.length" class="ud-feed">
            <div
              v-for="f in feedRows"
              :key="f.key"
              class="ud-feed__row"
              :class="{ 'ud-feed__row--link': !!f.sessionId }"
              :role="f.sessionId ? 'button' : undefined"
              :tabindex="f.sessionId ? 0 : undefined"
              @click="f.sessionId && openSession(f.sessionId)"
              @keydown.enter="f.sessionId && openSession(f.sessionId)"
            >
              <span class="ud-feed__time">{{ f.time }}</span>
              <div class="ud-feed__grow">
                <span class="ud-feed__t" :title="f.title">{{ f.title }}</span>
                <span class="ud-feed__d" :title="f.detail">{{ f.detail }}</span>
              </div>
              <span class="mk-badge mk-badge--sm mk-badge--muted">{{ f.kind }}</span>
            </div>
          </div>
          <p v-else class="ud-feed__empty">暂无活动记录 —— 该用户上课或发起目标对话后，这里会出现时间线。</p>
        </section>
      </div>

      <!-- 列表去重（2026-10-03 用户拍板「收到一起」）：教学会话/目标对话独立 tab 退役——
           两 tab 的数据本就是 limit 5 的切片（比概览 feed 的 8 条还少），与 feed 纯重复；
           每人全量列表的所有权归 LearnerDetail（学习轴 8 tab）与三个主列表页（支持 userId 过滤）。
           feed 行点击仍直达只读座舱，排查路径不变 -->
      <!-- 开发视角许可：一行条（原型 .statusbar 词汇：徽章 + 说明 + 右侧动作；按钮走 mk-btn 层级） -->
      <!-- 许可与接入（开发视角许可一行条 + 投影 token 生命周期） -->
      <section class="mk-card">
        <div class="mk-card__head"><h3 class="mk-card__title">许可与接入</h3></div>
        <div class="ud-pane">
        <div class="ud-grant__bar">
          <span class="mk-badge" :class="grantBadgeCls">开发视角许可 · {{ grantStatusLabel }}</span>
          <span class="ud-grant__meta" :title="grantStatus === 'active' ? grantNoteLabel : undefined">
            <template v-if="grantStatus === 'active'">
              {{ grantScopeLabel }}<template v-if="projectionGrant?.expiresAt"> · 至 {{ grantExpiresLabel }}</template><template v-if="projectionTokenExpiryLabel"> · {{ projectionTokenExpiryLabel }}</template>
            </template>
            <template v-else>用户授予协助许可后，可打开开发调试站进入其视角排查问题</template>
          </span>
          <span class="ud-grant__bar-actions">
            <button type="button" class="mk-btn mk-btn--sm" :disabled="grantLoading" @click="loadGrant">
              {{ grantLoading ? '刷新中…' : '刷新' }}
            </button>
            <button
              v-if="grantStatus === 'active'"
              type="button"
              class="mk-btn mk-btn--primary mk-btn--sm"
              :disabled="grantOpening"
              @click="openDebugStation"
            >
              {{ grantOpening ? '打开中…' : '打开开发调试站' }}
            </button>
          </span>
        </div>
        <!-- 区块级提示：走全局 .mk-alert（原型 .alert 词汇），仅错误态展示 -->
        <div v-if="grantMsgTone === 'error'" class="mk-alert ud-grant__notice">{{ grantMessage }}</div>
        </div>
      </section>
  </div>

  <div v-else-if="detailError" class="ud-root">
    <MkEmptyState
      icon="◌"
      tone="error"
      title="详情加载失败"
      :description="detailErrorMsg || '暂时无法获取该用户的完整信息。'"
      action-text="重试"
      @action="loadDetail"
    />
  </div>

  <div v-else class="ud-root">
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
import { subPage, openSubPage } from './store'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import { liveUsers, timeAgo, errMsg } from './live'
import { adminUsersApi, adminTeachingSessionsApi, adminGoalConversationsApi, getUserIncludingDeleted, restoreUser } from '@/api/adminApi'
import { statusText } from './statusText'
import { levelBadgeZh } from './learner-profile'
import { getProjectionGrantStatus, normalizeProjectionGrant, type ProjectionGrant } from '@/api/userCustom'
import { clearProjectionToken, setProjectionToken } from '@/utils/projection'
import { toast } from '@/utils/toast'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { useRowMenu } from './useRowMenu'

/* 本组件 = LearnerDetail「账号与许可」tab 的 pane（2026-10-03 人员详情合并）：
   由整页降为嵌入 pane，userId 走 props；hero/页签归宿主，账号轴内容原地保留。
   props/uid 必须声明在 script 顶部：下方 watch(immediate) 深链挂载时同步调
   loadDetail，声明在后会撞 TDZ（原 UserDetail 同款教训，P1#14 注记） */
const props = defineProps<{ userId: string }>()
const uid = computed(() => props.userId)

interface Detail {
  name: string
  email: string
  role: string
  joined: string
  /** 绝对时间（概览 kv 的 title 提示用；相对时间在副文里会被截断） */
  joinedAbs: string
  /** 最后登录（仅列表兜底数据有；详情接口不回该字段） */
  lastLogin: string
  lastLoginAbs: string
  stats: { label: string; value: string; hint?: string }[]
}

const liveDetail = ref<Detail | null>(null)
/** 会话总数（P1#14 角标口径）：从列表兜底 _count（live.ts fetchLiveUsers 的 sessions）或详情接口
 *  user._count.teaching_sessions 取；null = 无总数来源，角标退化为「最近 N」 */
const tsTotal = ref<number | null>(null)

/** XP 项的升级语境（批E，公式与后端 level.util.ts 同源） */
function xpHintOf(xp: number): string {
  const n = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
  const toNext = Math.max(100 * n * n - xp, 0)
  return toNext > 0 ? `距 L${n + 1} 还需 ${toNext} XP` : '已达最高档'
}
/** 绝对时间（概览 kv 的 title；timeAgo 的相对文案不带完整时刻） */
function fmtAbs(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString('zh-CN', { hour12: false })
}

// ===== 用户维度活动数据（教学会话 / 目标对话，真实接口 userId 过滤） =====
interface SessionRow {
  id: string
  topic: string
  subText: string
  status: string
  startAgo: string
  /** 概览 feed 排序用（timeAgo 只出相对文案，无法回排） */
  startTs: number
}
interface GoalRow {
  id: string
  stage: string
  summary: string
  subText: string
  createdAgo: string
  createdTs: number
}
const tsRows = ref<SessionRow[]>([])
const gcRows = ref<GoalRow[]>([])
const tsLoading = ref(false)
const gcLoading = ref(false)
const tsError = ref(false)
const gcError = ref(false)

/** 概览「最近活动」：教学会话 + 目标对话按时间合并（原型 renderLearnerDetail 最近活动 feed 形态），
    行可下钻只读座舱（session-real 同时收教学会话与目标会话 id） */
interface FeedItem {
  key: string
  kind: '会话' | '目标'
  ts: number
  time: string
  title: string
  detail: string
  sessionId: string
}
const feedRows = computed<FeedItem[]>(() => {
  const items: FeedItem[] = [
    ...tsRows.value.map((s) => ({ key: `ts-${s.id}`, kind: '会话' as const, ts: s.startTs, time: s.startAgo, title: s.topic, detail: s.subText, sessionId: s.id })),
    ...gcRows.value.map((g) => ({ key: `gc-${g.id}`, kind: '目标' as const, ts: g.createdTs, time: g.createdAgo, title: g.summary, detail: g.subText, sessionId: g.id }))
  ]
  return items.sort((a, b) => b.ts - a.ts).slice(0, 8)
})

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
      if (uid.value !== id) return
      const body = res.data?.data ?? res.data ?? {}
      tsRows.value = ((body.items as Record<string, unknown>[]) || []).map((s) => {
        const dur = Number(s.duration || 0)
        const durationText = dur >= 60 ? `${Math.round(dur / 60)} 分钟` : dur > 0 ? `${dur} 秒` : ''
        return {
          id: String(s.id),
          topic: String(s.topic || s.taskId || '未命名会话'),
          subText: `${String(s.subject || '—')} · ${Number(s.messageCount || 0)} 条消息${durationText ? ` · 时长 ${durationText}` : ''}`,
          status: String(s.status || ''),
          startAgo: timeAgo(String(s.startTime || '')),
          startTs: new Date(String(s.startTime || '')).getTime() || 0
        }
      })
    })
    .catch(() => {
      if (uid.value === id) tsError.value = true
    })
    .finally(() => {
      if (uid.value === id) tsLoading.value = false
    })
  const gc = adminGoalConversationsApi
    .list({ userId: id, limit: 4, includeTest: true })
    .then((res) => {
      if (uid.value !== id) return
      const body = res.data?.data ?? res.data ?? {}
      gcRows.value = ((body.conversations as Record<string, unknown>[]) || []).map((c) => ({
        id: String(c.id),
        stage: String(c.stage || ''),
        summary: goalSummaryOf(c),
        subText: `${statusText(String(c.status || '')) || '—'}${c.learningPathId ? ' · 已生成学习路径' : ''}`,
        createdAgo: timeAgo(String(c.createdAt || '')),
        createdTs: new Date(String(c.createdAt || '')).getTime() || 0
      }))
    })
    .catch(() => {
      if (uid.value === id) gcError.value = true
    })
    .finally(() => {
      if (uid.value === id) gcLoading.value = false
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

const projectionGrant = ref<ProjectionGrant | null>(null)
const grantLoading = ref(false)
const grantOpening = ref(false)
const grantMessage = ref('')
/** 许可消息语义：info（蓝色提示）/ error（红色错误）；模板按语义挂 .mk-alert--info / .mk-alert */
const grantMsgTone = ref<'info' | 'error'>('info')

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
  if (uid.value) void loadGrant()
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
  const id = uid.value
  if (!id) return
  grantLoading.value = true
  grantMessage.value = ''
  try {
    const res = await adminUsersApi.getProjectionGrant(id)
    // 竞态守卫：await 期间用户已切到别的用户，丢弃本响应
    if (uid.value !== id) return
    const body = res.data?.data ?? res.data
    const list = Array.isArray(body) ? body : body?.items || body?.grants || (body ? [body] : [])
    const first = list[0] || null
    projectionGrant.value = normalizeProjectionGrant(first) || normalizeProjectionGrant(body)
    if (!projectionGrant.value) {
      grantMessage.value = '当前还没有生效中的协助授权。'
      grantMsgTone.value = 'info'
    }
  } catch (e) {
    // 竞态守卫（回归 R2）：catch 侧同样要比对 id——await 期间已切到别的用户时，
    // 旧用户的失败结果不能写到新用户页面（try 侧守卫只覆盖成功路径）
    if (uid.value !== id) return
    projectionGrant.value = null
    grantMessage.value = `许可读取失败：${errMsg(e)}`
    grantMsgTone.value = 'error'
  } finally {
    // loading 复位也要带守卫：新用户请求已在途时，旧请求的 finally 不能提前关掉它的 loading
    if (uid.value === id) grantLoading.value = false
  }
}

async function openDebugStation() {
  const id = uid.value
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
    grantMsgTone.value = 'error'
  } finally {
    grantOpening.value = false
  }
}

/** 加载序号：详情在两个用户间快速切换时，旧请求后到会覆盖新数据——last-wins 守卫。
    必须声明在下方 watch 之前：watch 带 immediate，深链挂载（subPage 已设）时会在
    setup 期间同步调用 loadDetail，声明在后会撞 TDZ（ReferenceError），请求永不发出 */
let detailLoadSeq = 0

watch(
  () => uid.value,
  () => {
    liveDetail.value = null
    projectionGrant.value = null
    grantMessage.value = ''
    detailError.value = false
    isDeleted.value = false
    tsTotal.value = null
    const id = uid.value
    if (!id) return
    void loadDetail()
  },
  { immediate: true }
)

/* 危险动作（原型详情页 hero 的 停用账户 同位）：产品语义 = 软删（可在列表/本页恢复）。
   自保护口径与 Users.vue 一致（宁可不显示也不误禁他人），已删除态隐藏（恢复入口顶替） */
const currentAdminId = computed(() => {
  const raw = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user')
  if (!raw) return ''
  try {
    return String(JSON.parse(raw).id || '')
  } catch {
    return ''
  }
})
const canDelete = computed(
  () => !isDeleted.value && !!uid.value && uid.value !== currentAdminId.value
)
/* 危险动作收进 hero ⋯ 菜单：先关菜单再走确认弹层（避免菜单残留在确认层之上） */
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()
async function menuDelete() {
  closeMenu()
  await doDelete()
}
async function doDelete() {
  const id = uid.value
  const name = liveDetail.value?.name || id
  if (!id || !canDelete.value) return
  const ok = await askConfirm({
    title: '删除用户',
    message: `确认删除用户「${name}」（${liveDetail.value?.email || ''}）？\n删除后用户将无法登录，历史数据保留，可在后台恢复。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  try {
    await adminUsersApi.deleteUser(id)
    toast.success(`「${name}」已删除`)
    doneConfirm()
    // 停在本页：重拉后 isDeleted 翻真，删除入口被「恢复用户」顶替，详情态与后端一致
    void loadDetail()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  }
}

/** Phase 2：恢复已软删用户（身份保留策略下无需查重；成功后重拉详情，恢复入口自动消失） */
async function doRestore() {
  const id = uid.value
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
    if (uid.value !== id) return
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
  const id = uid.value
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
    if (seq !== detailLoadSeq || uid.value !== id) return
    const raw = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    isDeleted.value = !!raw.deletedAt
    const user = (raw.user as Record<string, unknown>) || raw
    // 后端不返回 learning_paths 明细：路径计数用 _count 兜底，与统计条口径一致
    const counts = (user._count as Record<string, number>) || {}
    const pathCount = Number(counts.learningPaths ?? counts.learning_paths ?? base?.paths ?? 0)
    // P1#14：会话总数优先详情 _count，其次列表兜底（live.ts fetchLiveUsers 的 sessions 即 _count.teaching_sessions）
    const detailSessions = counts.teaching_sessions ?? counts.teachingSessions
    tsTotal.value =
      detailSessions != null
        ? Number(detailSessions)
        : base?.sessions != null
          ? base.sessions
          : null
    liveDetail.value = {
      name: String(user.name || base?.name || id),
      email: String(user.email || base?.email || ''),
      role: user.isAdmin || base?.isAdmin ? '管理员' : '用户',
      joined: timeAgo(String(user.createdAt || base?.createdAt || '')),
      joinedAbs: fmtAbs(String(user.createdAt || base?.createdAt || '')),
      lastLogin: base?.lastLoginAt ? timeAgo(String(base.lastLoginAt)) : '',
      lastLoginAbs: base?.lastLoginAt ? fmtAbs(String(base.lastLoginAt)) : '',
      stats: [
        { label: '路径', value: String(base?.paths ?? pathCount) },
        // 列表兜底缺失时不臆造 0：无数据显示 '—'
        { label: '会话', value: base?.sessions != null ? String(base.sessions) : '—' },
        { label: 'XP', value: String(user.xp ?? 0), hint: xpHintOf(Number(user.xp ?? 0)) },
        // 等级词汇单点（learner-profile.ts levelBadgeZh）：统一「L2 · 进阶」格式
        { label: '等级', value: levelBadgeZh(Number(user.xp ?? 0), user.currentLevel ? String(user.currentLevel) : base?.currentLevel || ''), hint: '按 XP 推导 · 词汇=模型评估层级' }
      ]
    }
  } catch (e) {
    if (seq !== detailLoadSeq || uid.value !== id) return
    // 详情接口失败：用列表数据兜底；无兜底 → 明确错误态
    if (base) {
      tsTotal.value = base.sessions
      liveDetail.value = {
        name: base.name,
        email: base.email,
        role: base.isAdmin ? '管理员' : '用户',
        joined: timeAgo(base.createdAt),
        joinedAbs: fmtAbs(base.createdAt),
        lastLogin: base.lastLoginAt ? timeAgo(String(base.lastLoginAt)) : '',
        lastLoginAbs: base.lastLoginAt ? fmtAbs(String(base.lastLoginAt)) : '',
        stats: [
          { label: '路径', value: String(base.paths) },
          { label: '会话', value: String(base.sessions) },
          { label: 'XP', value: String(base.xp), hint: xpHintOf(Number(base.xp)) },
          { label: '等级', value: levelBadgeZh(Number(base.xp), base.currentLevel), hint: '按 XP 推导 · 词汇=模型评估层级' }
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

/* 账号概览读数 → 共享 MkStatStrip（grid 变体）所需条目（title 承接原 statstrip 格的 hint） */
const accountStatItems = computed(() => (d.value?.stats || []).map((s) => ({ label: s.label, value: s.value, title: s.hint })))

/* P1#15 的「学习状态」格已撤（P2 2026-10-04 全站评审）：趋势/疲劳/置信与同屏 hero pills
   逐项复读；学习者轴读数归位 LearnerDetail 页级 statstrip（仅学习轴页签渲染）。 */
</script>

<style scoped>
.ud { gap: 16px; }
/* 骨架屏（P0-2）：加载中替代纯文字，避免布局跳动 */
/* 骨架形状（shimmer 视觉统一走 .mk-skeleton） */
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.ud-skel { display: grid; gap: 14px; padding-top: 8px; }
/* 页头身份区走 .mk-entity（shared.css）；本页只保留页头内的统计行 */
/* 状态条已在 2026-10-05（批次五 CM2）收敛为共享 MkStatStrip 的 grid 变体：
   原本地 .statstrip 复刻（18px 数值档/两行换行）整块退役，样式归组件。 */

/* 主卡（原型详情页主区结构）：subtabs 在卡顶，pane 在卡内。
   pane 内边距 = 原型 .subpane（--sp-4 → 16px）；列表 pane 贴卡边（原型 sessions pane 表格同款） */
.ud-pane { display: grid; gap: 16px; padding: 16px; }
/* 概览 pane（原型 overview）：卡网格；嵌套卡沿 mk-card 描边形态 */
.ud-ov { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

/* 账户信息 kv（原型 .kv：96px 标签列；hero 副文会截断，这里给全量字段） */
.ud-kv {
  display: grid; grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 14px; align-items: baseline;
  padding: 0 16px 16px; margin: 0;
}
.ud-kv dt { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ud-kv dd {
  margin: 0; font-size: var(--mk-fs-body); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 最近活动 feed（原型 .feedrow：62px 时间列 + 标题/详情两行；会话与目标行可下钻座舱） */
.ud-feed { display: grid; padding: 0 8px 8px; }
.ud-feed__row { display: flex; gap: 10px; align-items: center; padding: 9px 8px; border-bottom: 1px solid var(--mk-line); }
.ud-feed__row:last-child { border-bottom: 0; }
.ud-feed__row--link { cursor: pointer; border-radius: var(--mk-radius-md); }
.ud-feed__row--link:hover { background: var(--mk-surface-2); }
.ud-feed__row--link:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
.ud-feed__time { flex: none; width: 62px; color: var(--mk-faint); font-size: var(--mk-fs-micro); font-family: var(--mk-mono); }
.ud-feed__grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.ud-feed__t { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ud-feed__d { color: var(--mk-muted); font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ud-feed__empty { padding: 2px 16px 14px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* 开发视角许可：一行条（pane 内，不再自带卡壳内边距） */
.ud-grant__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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
/* 区块级提示走全局 .mk-alert（阴影/圆角/配色由原语负责），留白由 pane 栅格负责 */
.ud-grant__notice { margin: 0; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ud-grant__meta { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号升到 2800 级（17px 级） */
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ud-grant__meta { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .mk-row__sub { font-size: var(--mk-fs-emphasis); }
  .ud-grant__meta { font-size: var(--mk-fs-emphasis); }
}
</style>
