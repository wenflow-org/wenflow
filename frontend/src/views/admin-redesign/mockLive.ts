/**
 * 真实数据接入层：把 mock admin 接到后端真实 API
 * 覆盖：执行日志（→ spans → 日志/瀑布/抽屉统计）、Skill 注册表（→ 矩阵）、总览统计
 * 失败时回退演示数据并给出错误提示
 */
import { ref } from 'vue'
import { adminAxios, adminDashboardApi, adminSkillsApi } from '@/api/adminApi'
import {
  dataSource,
  liveSpans,
  liveSkillStatsMap,
  liveOverview,
  type TraceSpan,
  type SkillStat
} from './mockStore'

export const liveLoading = ref(false)
export const liveError = ref('')

/* ---------- 执行日志 → TraceSpan ---------- */
interface RawLog {
  id?: string | number
  agentName?: string
  agentId?: string
  status?: string
  durationMs?: number
  createdAt?: string
  traceId?: string
  sessionId?: string
  sourceEntry?: string
  errorMessage?: string
  error?: string
  input?: string
  output?: string
}

function mapStatus(s?: string): TraceSpan['status'] {
  if (s === 'error') return 'err'
  if (s === 'timeout') return 'warn'
  return 'ok'
}

async function fetchLiveSpans(): Promise<TraceSpan[]> {
  const res = await adminAxios.get('/admin/agents/logs', {
    params: { timeRange: 'week', limit: 60 }
  })
  const body = res.data?.data ?? res.data ?? {}
  const items: RawLog[] = body.items || body.logs || body || []

  // 按 traceId 分组计算相对偏移（瀑布用）
  const byTrace = new Map<string, number>()
  for (const log of items) {
    const t = log.traceId || `log:${log.id}`
    const ts = log.createdAt ? new Date(log.createdAt).getTime() : 0
    const cur = byTrace.get(t)
    if (cur === undefined || ts < cur) byTrace.set(t, ts)
  }

  return items.map((log, i) => {
    const traceId = log.traceId || `log:${log.id}`
    const ts = log.createdAt ? new Date(log.createdAt).getTime() : 0
    const errText = log.errorMessage || log.error || ''
    return {
      id: String(log.id ?? i),
      traceId,
      kind: 'call' as const,
      agent: log.agentId || log.agentName || 'unknown',
      stage: log.agentName || log.agentId || '未知节点',
      title: errText ? `调用失败：${errText.slice(0, 40)}` : '执行完成',
      startMs: Math.max(0, ts - (byTrace.get(traceId) || ts)),
      durationMs: Number(log.durationMs || 0),
      status: mapStatus(log.status),
      detail: [log.status === 'error' ? '失败' : log.status === 'timeout' ? '超时' : '成功', `${log.durationMs || 0}ms`, log.sourceEntry].filter(Boolean).join(' · '),
      payload: errText || undefined
    }
  })
}

/* ---------- Skill 注册表 → 矩阵统计 ---------- */
interface RawSkill {
  skillId?: string
  id?: string
  name?: string
  displayName?: string
  category?: string
  tier?: string
  description?: string
  stats?: { callCount?: number; successRate?: number; avgLatency?: number; lastCalledAt?: string }
  runtime?: { stats?: { callCount?: number; successRate?: number; avgLatency?: number; lastCalledAt?: string } }
}

export interface LiveSkillProfile {
  id: string
  name: string
  category: string
}

export const liveSkillProfiles = ref<LiveSkillProfile[]>([])

async function fetchLiveSkills(): Promise<Record<string, SkillStat>> {
  const res = await adminSkillsApi.getSkills()
  const body = res.data?.data ?? res.data ?? {}
  const items: RawSkill[] = Array.isArray(body) ? body : body.skills || body.items || []

  const statsMap: Record<string, SkillStat> = {}
  const profiles: LiveSkillProfile[] = []

  for (const s of items) {
    // 真实注册表：skill 的标识在 name 字段
    const id = s.skillId || s.id || s.name || ''
    if (!id) continue
    const st = s.stats || s.runtime?.stats || {}
    const calls = Number(st.callCount || 0)
    const rate = Number(st.successRate ?? 1)
    statsMap[id] = {
      calls,
      errors: calls > 0 ? Math.round(calls * (1 - rate)) : 0,
      avgMs: Number(st.avgLatency || 0),
      lastAt: st.lastCalledAt ? '近期' : '从未'
    }
    profiles.push({
      id,
      name: s.displayName || s.description?.slice(0, 12) || id,
      category: s.category || s.tier || 'skill'
    })
  }

  liveSkillProfiles.value = profiles
  return statsMap
}

/* ---------- 总览统计 ---------- */
async function fetchLiveOverview() {
  const res = await adminDashboardApi.getStats()
  const stats = res.data?.data ?? res.data ?? {}
  const agents = stats.agents || {}
  const users = stats.users || {}
  const todayCalls = Number(agents.todayCalls || 0)
  const successRate = Number(agents.successRate ?? 100)
  const activeUsers = Number(users.activeToday || 0)

  if (todayCalls === 0 && activeUsers === 0) {
    return { tone: 'muted' as const, score: 100, headline: '系统空闲', subline: '部署完成，等待第一个真实学习者。' }
  }
  if (todayCalls >= 5 && successRate < 90) {
    return { tone: 'warn' as const, score: Math.max(40, Math.round(successRate * 0.7)), headline: `需要关注：成功率 ${successRate}%`, subline: `今日 ${todayCalls} 次调用，成功率低于阈值。` }
  }
  return { tone: 'ok' as const, score: 92, headline: '运行平稳', subline: `今日 ${todayCalls} 次调用 · ${activeUsers} 人活跃。` }
}

/* ---------- 总入口 ---------- */
export async function loadLiveData() {
  liveLoading.value = true
  liveError.value = ''
  try {
    const [spans, skills, overview] = await Promise.all([
      fetchLiveSpans(),
      fetchLiveSkills(),
      fetchLiveOverview()
    ])
    liveSpans.value = spans
    liveSkillStatsMap.value = skills
    liveOverview.value = overview
    dataSource.value = 'live'
  } catch (e) {
    const err = e as { response?: { status?: number }; message?: string }
    liveError.value = err?.response?.status === 401
      ? '需要 admin 登录'
      : `真实数据拉取失败：${err?.message || '网络错误'}`
    dataSource.value = 'demo'
  } finally {
    liveLoading.value = false
  }
}

export function backToDemo() {
  dataSource.value = 'demo'
  liveError.value = ''
}
