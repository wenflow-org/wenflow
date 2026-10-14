<template>
  <div v-if="d" class="ud-root">
    <!-- 页签重排（2026-10-11）：①账号轴统计带整条撤除（四个事实各归其主：
         会话→教学会话页签头部读数、XP 与等级→画像、路径→概览当前进度）；
         ②账户信息与许可合并为一张卡（外部评审 #3 成立：许可原独占一卡，
         卡体只有一句灰字，与左卡等高后下半张全空）；
         ③最近活动仍全宽（行内含标题+详情+类型，窄列会挤）。 -->
    <div class="ud-pane ud-ov">
        <section class="mk-card">
          <!-- 账号轴的状态与账户操作归「账户信息」卡头（2026-10-08 重做）：沿用全站卡头语法，
               标题吃剩余宽度、尾部元素贴右（「头内成组」规则）。 -->
          <div class="mk-card__head">
            <h3 class="mk-card__title">账户与许可</h3>
            <div class="mk-card__head-right">
              <span class="mk-badge" :class="isDeleted ? 'mk-badge--deleted' : 'mk-badge--ok'">
                {{ isDeleted ? '已删除' : '正常' }}
              </span>
              <button v-if="isDeleted" type="button" class="mk-btn mk-btn--sm" :disabled="restoring" @click="doRestore">
                {{ restoring ? '恢复中…' : '恢复用户' }}
              </button>
              <div v-if="canDelete" class="mk-menu">
                <button type="button" class="mk-menu__btn" aria-label="账户操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu('account')">⋯</button>
                <div v-if="openMenu === 'account'" class="mk-menu__pop" :style="popStyle" @click.stop>
                  <button type="button" class="mk-menu__item mk-menu__item--danger" title="软删除：禁止登录，历史数据保留，可在用户列表恢复" @click="menuDelete">删除账户…</button>
                </div>
              </div>
            </div>
          </div>
          <!-- 两列 kv（外部评审 #2 采纳）：单列时字段只占左半、右半空着；两列并排把
               六个事实压成三行，卡高与信息量匹配 -->
          <dl class="ud-kv ud-kv--2col">
            <dt>邮箱</dt><dd :title="d.email">{{ d.email }}</dd>
            <dt>角色</dt><dd>{{ d.role }}</dd>
            <dt>账号类型</dt><dd>{{ acctType }}</dd>
            <dt>加入时间</dt><dd :title="d.joinedAbs || undefined">{{ d.joined || '—' }}</dd>
            <dt>最后登录</dt><dd :title="d.lastLoginAbs || undefined">{{ d.lastLogin || '—' }}</dd>
            <!-- 支持排查要对齐 ID（会话/座舱/日志里的引用都是它）：列短号，全文进 title -->
            <dt>用户 ID</dt><dd class="ud-kv__mono" :title="uid">{{ shortId(uid) }}</dd>
            <!-- 许可按「账户属性的一行」收编（外部评审 #2 原建议）：标签 + 徽章 + 说明 + 右端动作
                 同处一行——比另起一个带分隔线的许可块更紧凑，也避免徽章与动作之间拉出长空档 -->
            <dt>开发视角许可</dt>
            <dd class="ud-kv__wide">
              <span class="mk-badge" :class="grantBadgeCls">{{ grantStatusLabel }}</span>
              <span class="ud-grant-row__meta" :title="grantStatus === 'active' ? grantNoteLabel : undefined">
                <template v-if="grantStatus === 'active'">
                  {{ grantScopeLabel }}<template v-if="projectionGrant?.expiresAt"> · 至 {{ grantExpiresLabel }}</template><template v-if="projectionTokenExpiryLabel"> · {{ projectionTokenExpiryLabel }}</template>
                </template>
                <template v-else>用户授予协助许可后，可打开开发调试站进入其视角排查问题</template>
              </span>
              <span class="ud-grant-row__acts">
                <button type="button" class="mk-btn mk-btn--sm" :disabled="grantLoading" @click="loadGrant">
                  {{ grantLoading ? '刷新中…' : '刷新' }}
                </button>
                <button
                  v-if="grantStatus === 'active'"
                  type="button" class="mk-btn mk-btn--primary mk-btn--sm"
                  :disabled="grantOpening"
                  @click="openDebugStation"
                >
                  {{ grantOpening ? '打开中…' : '打开开发调试站' }}
                </button>
              </span>
            </dd>
          </dl>
          <!-- 区块级提示：走全局 .mk-alert（原型 .alert 词汇），仅错误态展示 -->
          <div v-if="grantMsgTone === 'error'" class="mk-alert ud-grant-row__notice">{{ grantMessage }}</div>
        </section>
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近活动</h3>
            <span class="mk-card__meta">{{ feedMetaText }}</span>
          </div>
          <div v-if="feedRows.length" class="ud-feed">
          <!-- 行结构（2026-10-11 外部评审 #2 采纳）：时间列 → 类型徽章 → 内容两行。
               原先是单行 nowrap 拉满全宽（长 prompt 一路顶到卡缘、右侧只剩一个孤悬徽章），
               现标题最多两行折行 + 文本列设可读宽度上限，类型徽章贴内容而非钉在最右 -->
          <div class="ud-feed__row"
            v-for="f in feedRows"
            :key="f.key"
            :class="{ 'ud-feed__row--link': !!f.sessionId }"
            :role="f.sessionId ? 'button' : undefined"
            :tabindex="f.sessionId ? 0 : undefined"
            @click="f.sessionId && openSession(f.sessionId)"
            @keydown.enter="f.sessionId && openSession(f.sessionId)"
            @keydown.space.prevent="f.sessionId && openSession(f.sessionId)"
          >
            <span class="ud-feed__time">{{ f.time }}</span>
            <span class="mk-badge mk-badge--sm mk-badge--muted ud-feed__kind">{{ f.kind }}</span>
            <div class="ud-feed__grow">
              <span class="ud-feed__t" :title="f.title">{{ f.title }}</span>
              <!-- 状态点（2026-10-11 外部评审 #3）：副行状态文案前加 tone 圆点，
                   一行扫下来就能看出成功/异常，不必逐字读 -->
              <span class="ud-feed__d" :title="f.detail">
                <i class="ud-feed__dot" :data-tone="f.tone" aria-hidden="true"></i>{{ f.detail }}
              </span>
            </div>
            <!-- 行尾点击暗示（纯视觉，整行才是点击目标，不做嵌套可聚焦控件）：
               宽屏下文本列限宽后右端原本是死区，这里给出行可点的信号 -->
            <span v-if="f.sessionId" class="ud-feed__go" aria-hidden="true">详情 ›</span>
          </div>
          </div>
          <p v-else class="ud-feed__empty">暂无活动记录 —— 该用户上课或发起目标对话后，这里会出现时间线。</p>
        </section>
    </div>
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
import { liveUsers, timeAgo, errMsg, shortId } from './live'
import { adminUsersApi, adminTeachingSessionsApi, adminGoalConversationsApi, getUserIncludingDeleted, restoreUser } from '@/api/adminApi'
import { statusText } from './statusText'
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
}

const liveDetail = ref<Detail | null>(null)
/** 会话总数（P1#14 角标口径）：从列表兜底 _count（live.ts fetchLiveUsers 的 sessions）或详情接口
 *  user._count.teaching_sessions 取；null = 无总数来源，角标退化为「最近 N」 */
const tsTotal = ref<number | null>(null)

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
  /** 原始状态机值（statusText 只出中文，状态点语气要用原值；2026-10-11 外部评审 #3） */
  status: string
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
  /** 副行状态点语气 */
  tone: 'ok' | 'warn' | 'info' | 'muted'
}
/** 会话/目标状态 → 活动行状态点语气（ok 绿 / warn 琥珀 / info 蓝 / muted 灰） */
function statusTone(status: string): 'ok' | 'warn' | 'info' | 'muted' {
  const s = String(status || '').toLowerCase()
  if (s === 'completed' || s === 'succeeded') return 'ok'
  if (['failed', 'timeout', 'finalization_failed', 'discarded'].includes(s)) return 'warn'
  if (['active', 'running', 'paused', 'initializing', 'finalizing'].includes(s)) return 'info'
  return 'muted'
}
const feedRows = computed<FeedItem[]>(() => {
  /* 已废弃（学习者点「重新开始」后作废的旧会话）不进活动时间线（2026-10-11）：
     口径与概览「最近会话」预览、教学会话页签的「有效」档一致——否则时间线会被
     驱动重开的 1 秒会话顶满。隐藏条数在卡头 meta 如实标注。 */
  const items: FeedItem[] = [
    ...tsRows.value
      .filter((s) => s.status !== 'discarded')
      .map((s) => ({ key: `ts-${s.id}`, kind: '会话' as const, ts: s.startTs, time: s.startAgo, title: s.topic, detail: s.subText, sessionId: s.id, tone: statusTone(s.status) })),
    ...gcRows.value.map((g) => ({ key: `gc-${g.id}`, kind: '目标' as const, ts: g.createdTs, time: g.createdAgo, title: g.summary, detail: g.subText, sessionId: g.id, tone: statusTone(g.status) }))
  ]
  return items.sort((a, b) => b.ts - a.ts).slice(0, 8)
})
/** feed 卡头口径：隐藏的废弃条数不静默（同概览「最近会话」预览写法） */
const feedMetaText = computed(() => {
  const hidden = tsRows.value.filter((s) => s.status === 'discarded').length
  const base = `会话 + 目标 · 最近 ${feedRows.value.length} 条`
  return hidden ? `${base} · 已隐藏废弃 ${hidden}` : base
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
        status: String(c.status || ''),
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
/* 危险动作收进「账户信息」卡头的 ⋯ 菜单：先关菜单再走确认弹层（避免菜单残留在确认层之上） */
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
    // 详情 _count：会话总数优先它，其次列表兜底（live.ts fetchLiveUsers 的 sessions 即 _count.teaching_sessions）
    const counts = (user._count as Record<string, number>) || {}
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
      lastLoginAbs: base?.lastLoginAt ? fmtAbs(String(base.lastLoginAt)) : ''
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
        lastLoginAbs: base.lastLoginAt ? fmtAbs(String(base.lastLoginAt)) : ''
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

/* 账号类型（2026-10-11 深设计）：这一页的主语标签——数据隔离/排查先要知道看的是谁。
   口径与列表徽章（MkVariantBadge 判例）、live.ts 的 isVirtualLearner/isTestAccount 一致 */
const acctType = computed(() => {
  const base = liveUsers.value.find((u) => u.id === uid.value)
  if (!base) return '—'
  if (base.isVirtualLearner) return '虚拟学习者'
  if (base.isTestAccount) return '测试账号'
  return '正式账号'
})
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

/* pane 内边距 = 16px；单列堆叠（2026-10-11 修）：合卡后本行只剩一张卡，
   两列网格会让它占半宽、右半张留黑（实测 782/1612）。窄档自适应由卡片自身 min-width 保证。 */
.ud-pane { display: grid; gap: 16px; padding: 16px; }
.ud-ov { grid-template-columns: minmax(0, 1fr); align-content: start; }

/* 基础 kv（96px 标签列）；两列变体把六个字段压成三行（宽卡里单列会右半空着） */
.ud-kv {
  display: grid; grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 14px; align-items: baseline;
  padding: 0 16px 16px; margin: 0;
}
.ud-kv--2col { grid-template-columns: 96px minmax(0, 1fr) 96px minmax(0, 1fr); }
@media (max-width: 900px) {
  .ud-kv--2col { grid-template-columns: 96px minmax(0, 1fr); }
}
/* 许可行的值格跨到行尾：徽章 + 说明（自动占满中间）+ 动作贴右；
   取消 dd 默认的单行截断（这里要放三个元素并允许换行） */
.ud-kv__wide {
  grid-column: 2 / -1;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  overflow: visible; white-space: normal; text-overflow: clip;
}
.ud-kv dt { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ud-kv dd {
  margin: 0; font-size: var(--mk-fs-body); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 用户 ID 等标识符单元格：mono + 稍弱（同全站 mono 判例） */
.ud-kv__mono { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }

/* 最近活动 feed：时间列 → 类型徽章 → 内容两行。
   标题最多两行（-webkit-line-clamp），文本列设可读宽度上限——长 prompt 原先是
   nowrap 单行拉满卡宽（4K 下单行 3000+px），横读极累；两行折行 + 限宽后读起来是段落。 */
.ud-feed { display: grid; padding: 0 8px 8px; }
.ud-feed__row {
  /* 四列：时间 | 类型 | 内容（限宽） | 行尾暗示——末列必须有，否则 go 会掉到下一行 */
  display: grid; grid-template-columns: 84px auto minmax(0, 1fr) auto;
  gap: 4px 10px; align-items: start; padding: 10px 8px;
  border-bottom: 1px solid var(--mk-line);
}
.ud-feed__row:last-child { border-bottom: 0; }
.ud-feed__row--link { cursor: pointer; border-radius: var(--mk-radius-md); }
.ud-feed__row--link:hover { background: var(--mk-surface-2); }
.ud-feed__row--link:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
.ud-feed__time {
  /* 列宽按最长文案（「14 小时前」在最大字号档 ≈66px）留余量 + nowrap：
     固定列宽是「类型徽章永远同一条竖线」的前提，nowrap 防折行（68px 时实测折成两行） */
  width: 84px; padding-top: 1px; padding-right: 4px; white-space: nowrap;
  /* 右对齐（2026-10-11 外部评审 #2）：时间文案长短不一（「14 小时前」/「昨天」），
     左对齐时文字尾端参差、到类型徽章的空档忽大忽小；右对齐后整列成列 */
  text-align: right;
  color: var(--mk-muted); font-size: var(--mk-fs-micro); font-family: var(--mk-mono);
}
.ud-feed__kind { margin-top: -1px; }
/* 内容列吃满剩余宽度（2026-10-11 用户走查「右边空那多」）：
   原 640px 限宽把宽卡里每行右半截留成死区；标题仍是两行封顶，
   行内文本因此能整段读完（实测 1080 下 160 字的目标描述两行放得下），不再半途省略 */
.ud-feed__grow { display: grid; gap: 3px; min-width: 0; }
.ud-feed__t {
  font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink);
  /* 行高 1.6（外部评审 #2「偏小偏紧」）：两行折行 + 限宽后可读性优先 */
  line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ud-feed__d { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 状态点：8px 圆点，语气色同全站语义（ok 绿 / warn 琥珀 / info 蓝 / muted 灰） */
.ud-feed__dot {
  display: inline-block; width: 7px; height: 7px; margin-right: 6px;
  border-radius: var(--mk-radius-pill); background: var(--mk-line); vertical-align: middle;
}
.ud-feed__dot[data-tone='ok'] { background: var(--mk-green); }
.ud-feed__dot[data-tone='warn'] { background: var(--mk-amber); }
.ud-feed__dot[data-tone='info'] { background: var(--mk-blue); }
.ud-feed__empty { padding: 2px 16px 14px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
/* 行尾点击暗示：弱色小字，行 hover 转蓝（整行才是点击目标，它是视觉信号不是控件） */
.ud-feed__go { align-self: center; color: var(--mk-faint); font-size: var(--mk-fs-micro); white-space: nowrap; }
.ud-feed__row--link:hover .ud-feed__go { color: var(--mk-blue); }

/* 许可行的说明小字（辅助层级，不随正文放大）；按内容收宽，
   避免 flex:1 把它拉成整行宽（会读成一条长灰带） */
.ud-grant-row__meta { margin: 0; flex: 0 1 auto; min-width: 0; max-width: 640px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ud-grant-row__acts { display: flex; gap: 8px; margin-left: auto; }
/* 区块级提示走全局 .mk-alert（阴影/圆角/配色由原语负责），留白由 pane 栅格负责 */
.ud-grant-row__notice { margin: 0 16px 12px; }

/* 大屏/4K 适配：本 pane 的字号全部走全站 token（壳层 zoom 档统一放大），
   无页私有档位需要覆盖；许可说明是辅助小字，不随正文放大参与层级竞争。 */
</style>
