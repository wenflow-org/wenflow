<template>
  <div class="wb mk-page">
    <!-- 顶部：全局统计条（G1：skill 总数 / aux / mainline / 异常 skill 数 + 生成时间 + 刷新） -->
    <div class="mk-status" :class="`mk-status--${barTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">巡检工作台</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">健康 13 项 · 漂移 · 对账 · 完成度 一页巡检</span>
      <template v-if="displayReport">
        <span class="mk-status__sep"></span>
        <span class="mk-status__meta" :title="displayReport.generatedAt">生成 {{ timeAgo(displayReport.generatedAt) }}</span>
        <span class="mk-status__sep"></span>
        <span class="mk-status__meta">Skill <b class="mk-status__num">{{ global.total }}</b></span>
        <span class="mk-status__meta">aux <b class="mk-status__num">{{ global.aux }}</b></span>
        <span class="mk-status__meta">mainline <b class="mk-status__num">{{ global.mainline }}</b></span>
        <span v-if="global.handlerOnly" class="mk-status__meta">handler-only <b class="mk-status__num">{{ global.handlerOnly }}</b></span>
        <span class="mk-badge" :class="global.abnormalSkills > 0 ? 'mk-badge--bad' : 'mk-badge--ok'">
          {{ global.abnormalSkills > 0 ? `异常 ${global.abnormalSkills}` : '全部健康' }}
        </span>
      </template>
      <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">
        {{ loading ? '检测中…' : '刷新' }}
      </button>
    </div>

    <div v-if="!isLive" class="wb-demo">演示数据（demo 模式）：切换 live 数据源后展示真实巡检结果</div>
    <div v-if="failed && isLive" class="wb-failed">
      <span>巡检数据加载失败：{{ errorText }}</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">重试</button>
    </div>

    <template v-if="displayReport">
      <!-- a. 健康检查：13 项（限高内滚，异常优先视觉） -->
      <section class="mk-card wb-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">健康检查</h3>
          <span class="mk-card__meta">{{ displayReport.health.summary.total }} 项检查</span>
          <span class="mk-card__meta">
            基准漂移 {{ displayReport.health.summary.baselineDrift }} · 一致性 {{ displayReport.health.summary.consistency }} · 覆盖记录 {{ displayReport.health.summary.overrideRecord }}
          </span>
          <span class="mk-badge" :class="healthAbnormal > 0 ? 'mk-badge--bad' : 'mk-badge--ok'">
            {{ healthAbnormal > 0 ? `${healthAbnormal} 项异常` : '无异常' }}
          </span>
        </div>
        <div class="wb-hc-list">
          <div
            v-for="item in displayReport.health.items"
            :key="item.id"
            class="hc-item"
            :class="[`hc-item--${item.severity}`]"
          >
            <span class="hc-item__dot" :class="`hc-item__dot--${item.severity}`"></span>
            <div class="hc-item__main">
              <div class="hc-item__head">
                <strong class="hc-item__name">{{ item.label }}</strong>
                <span class="hc-item__status">{{ statusLabel(item) }}</span>
                <span class="hc-item__count">{{ item.count }}</span>
                <span class="hc-item__sem">{{ semanticsLabel(item.semantics) }}</span>
                <span class="hc-item__action-tag">{{ actionLabel(item.action) }}</span>
              </div>
              <p class="hc-item__cause">{{ item.cause }}</p>
              <details class="hc-item__detail">
                <summary>明细（{{ item.detail.length }}）</summary>
                <ul>
                  <li v-for="(d, i) in item.detail" :key="i" class="mono">{{ d }}</li>
                  <li v-if="item.detail.length === 0" class="hc-item__empty">无问题明细</li>
                </ul>
              </details>
              <p class="hc-item__hint mono">{{ item.fixHint }}</p>
            </div>
            <div class="hc-item__ops">
              <button
                v-if="item.action === 'fixable' && item.severity !== 'ok'"
                type="button"
                class="hc-btn hc-btn--fix"
                :disabled="fixingId === item.id"
                @click="fix(item.id)"
              >{{ fixingId === item.id ? '修复中…' : '一键修复' }}</button>
              <button
                v-else-if="item.action === 'fixable'"
                type="button"
                class="hc-btn hc-btn--ghost"
                @click="fix(item.id)"
              >重跑</button>
              <button
                v-else-if="item.action === 'manual' && item.severity !== 'ok'"
                type="button"
                class="hc-btn hc-btn--ghost"
                @click="jump(item.id)"
              >查看 →</button>
            </div>
          </div>
        </div>
      </section>

      <!-- b. 漂移摘要：契约 / 哈希 / 运行时 三卡 + 跳转 -->
      <section class="mk-card wb-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">漂移摘要</h3>
          <span class="mk-card__meta">三种漂移语义独立计数，点击进入明细</span>
        </div>
        <div class="wb-stats">
          <button type="button" class="wb-stat" :class="driftTone(drift.contract)" @click="goDrift('contract')">
            <span class="wb-stat__label">{{ TERMS.driftContractQualified }}</span>
            <span class="wb-stat__num">{{ drift.contract }}</span>
            <span class="mk-badge" :class="badgeCls(drift.contract, 'bad')">{{ drift.contract > 0 ? '需处理' : '正常' }}</span>
            <span class="wb-stat__go">→ 编排结构 · 漂移 tab</span>
          </button>
          <button type="button" class="wb-stat" :class="driftTone(drift.hash)" @click="goDrift('hash')">
            <span class="wb-stat__label">{{ TERMS.driftHashQualified }}</span>
            <span class="wb-stat__num">{{ drift.hash }}</span>
            <span class="mk-badge" :class="badgeCls(drift.hash, 'bad')">{{ drift.hash > 0 ? '需处理' : '正常' }}</span>
            <span class="wb-stat__go">→ Skill 工作台</span>
          </button>
          <button type="button" class="wb-stat" :class="driftTone(drift.runtime)" @click="goDrift('runtime')">
            <span class="wb-stat__label">{{ TERMS.driftRuntime }}</span>
            <span class="wb-stat__num">{{ drift.runtime }}</span>
            <span class="mk-badge" :class="badgeCls(drift.runtime, 'warn')">{{ drift.runtime > 0 ? '观测到' : '正常' }}</span>
            <span class="wb-stat__go">→ 执行日志</span>
          </button>
        </div>
      </section>

      <!-- c. 对账摘要：W1-W5 计数卡 + 跳转 Skill 目录 -->
      <section class="mk-card wb-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">对账摘要</h3>
          <span class="mk-card__meta">户口簿 {{ reconciliation.total }} · 缺注册 / 幽灵注册 / 缺 ACTIVE / 接线差集</span>
          <button type="button" class="mk-status__action" @click="goSkills">→ Skill 目录对账面板</button>
        </div>
        <div class="wb-stats wb-stats--recon">
          <button type="button" class="wb-stat" :class="reconTone('missingRegistration')" @click="goSkills">
            <span class="wb-stat__label">缺注册（W2）</span>
            <span class="wb-stat__num">{{ reconciliation.missingRegistration }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.missingRegistration, 'bad')">{{ reconciliation.missingRegistration > 0 ? '异常' : '正常' }}</span>
          </button>
          <button type="button" class="wb-stat" :class="reconTone('zombieRegistration')" @click="goSkills">
            <span class="wb-stat__label">幽灵注册（W2）</span>
            <span class="wb-stat__num">{{ reconciliation.zombieRegistration }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.zombieRegistration, 'bad')">{{ reconciliation.zombieRegistration > 0 ? '异常' : '正常' }}</span>
          </button>
          <button type="button" class="wb-stat" :class="reconTone('missingActive')" @click="goSkills">
            <span class="wb-stat__label">缺 ACTIVE（W1）</span>
            <span class="wb-stat__num">{{ reconciliation.missingActive }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.missingActive, 'warn')">{{ reconciliation.missingActive > 0 ? '异常' : '正常' }}</span>
          </button>
          <button type="button" class="wb-stat" :class="reconTone('zombieActive')" @click="goSkills">
            <span class="wb-stat__label">幽灵 ACTIVE（W1）</span>
            <span class="wb-stat__num">{{ reconciliation.zombieActive }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.zombieActive, 'bad')">{{ reconciliation.zombieActive > 0 ? '异常' : '正常' }}</span>
          </button>
          <button type="button" class="wb-stat" :class="reconTone('zombieSkillActive')" @click="goSkills">
            <span class="wb-stat__label">僵尸 ACTIVE（W1）</span>
            <span class="wb-stat__num">{{ reconciliation.zombieSkillActive }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.zombieSkillActive, 'warn')">{{ reconciliation.zombieSkillActive > 0 ? '残留' : '正常' }}</span>
          </button>
          <button type="button" class="wb-stat" :class="reconTone('unwired')" @click="goSkills">
            <span class="wb-stat__label">接线差集（W3）</span>
            <span class="wb-stat__num">{{ reconciliation.unwired }}</span>
            <span class="mk-badge" :class="badgeCls(reconciliation.unwired, 'warn')">{{ reconciliation.unwired > 0 ? '异常' : '正常' }}</span>
          </button>
        </div>
      </section>

      <!-- d. 完成度分布：五档分布卡 + 跳转 Skill 目录 -->
      <section class="mk-card wb-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">完成度分布</h3>
          <span class="mk-card__meta">draft → live 五档 · 明细见 Skill 目录对账面板</span>
          <button type="button" class="mk-status__action" @click="goSkills">→ Skill 目录</button>
        </div>
        <div class="wb-stats wb-stats--rec">
          <div v-for="tier in completionTiers" :key="tier.status" class="wb-stat wb-stat--rec" :class="tier.status === 'live' ? 'wb-stat--live' : ''">
            <span class="mk-badge" :class="`mk-badge--rec-${tier.status}`">{{ tier.label }}</span>
            <span class="wb-stat__num">{{ tierCount(tier.status) }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from '@/utils/toast'
import { errMsg, timeAgo } from './live'
import { askConfirm } from './useConfirm'
import { isLive } from './store'
import {
  adminHealthCenterApi,
  type HealthCenterItem,
  type HealthCenterItemId,
  type HealthCenterSummaryReport,
  type HealthDriftSummary,
  type HealthGlobalSummary,
  type HealthReconciliationSummary,
} from '@/api/adminApi'
import { TERMS } from './terms'
import { COMPLETION_META } from './glossaryMeta'

const router = useRouter()
const route = useRoute()

const report = ref<HealthCenterSummaryReport | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const fixingId = ref<HealthCenterItemId | null>(null)

/** demo 模式降级：静态演示数据（G1 布局可见，live 模式不落此分支） */
const demoReport = ref<HealthCenterSummaryReport>(buildDemoReport())

/** 展示数据源：live 用真实聚合；demo 用降级数据 */
const displayReport = computed(() => (isLive.value ? report.value : demoReport.value))

const global = computed<HealthGlobalSummary>(
  () => displayReport.value?.global || { total: 0, aux: 0, mainline: 0, handlerOnly: 0, abnormalSkills: 0 },
)
const drift = computed<HealthDriftSummary>(
  () => displayReport.value?.drift || { contract: 0, hash: 0, runtime: 0 },
)
const reconciliation = computed<HealthReconciliationSummary>(
  () =>
    displayReport.value?.reconciliation || {
      total: 0, missingRegistration: 0, zombieRegistration: 0,
      missingActive: 0, zombieActive: 0, zombieSkillActive: 0, unwired: 0,
    },
)
const distribution = computed(() => displayReport.value?.completion.distribution || {})
const healthAbnormal = computed(() => displayReport.value?.health.abnormal ?? 0)

/** 客户端聚合严重度计数（服务端 summary 不输出 ok/warn/error 明细） */
const counts = computed(() => {
  const c = { ok: 0, warn: 0, error: 0, info: 0 }
  for (const item of displayReport.value?.health.items || []) c[item.severity] = (c[item.severity] || 0) + 1
  return c
})

const barTone = computed(() => {
  if (!displayReport.value) return 'muted'
  if (counts.value.error > 0 || global.value.abnormalSkills > 0) return 'bad'
  if (counts.value.warn > 0) return 'warn'
  return 'ok'
})

const completionTiers = COMPLETION_META

function tierCount(status: string): number {
  return distribution.value?.[status as keyof typeof distribution.value] ?? 0
}

/* ---------- 异常显眼标注（1B mk-badge 档位：红=需处理 / 琥珀虚线=关注） ---------- */
function badgeCls(n: number, severe: 'bad' | 'warn'): string {
  if (n <= 0) return 'mk-badge--ok'
  return severe === 'bad' ? 'mk-badge--bad' : 'mk-badge--warn'
}
function driftTone(n: number): string {
  return n > 0 ? 'wb-stat--alert' : ''
}
function reconTone(key: string): string {
  return (displayReport.value?.reconciliation[key as keyof HealthReconciliationSummary] ?? 0) > 0 ? 'wb-stat--alert' : ''
}

/* ---------- 健康检查项展示（沿用 2B 现有实现） ---------- */
const statusLabelMap: Record<string, string> = {
  clean: '干净',
  drifted: '漂移',
  orphan: '孤儿',
  missing: '缺项',
  unregistered: '未注册',
  unwired: '未接线',
  'type-mismatch': '类型不一致',
  'missing-declarations': TERMS.statusMissing,
  active: '存在',
  none: '无',
  observed: '观测到',
  unavailable: '不可用',
}
function statusLabel(item: HealthCenterItem) {
  return statusLabelMap[item.status] || item.status
}
const semanticsLabelMap: Record<string, string> = {
  'baseline-drift': '基准漂移',
  consistency: '一致性偏差',
  'override-record': '覆盖记录',
  'runtime-info': '运行时观测',
}
function semanticsLabel(semantics: HealthCenterItem['semantics']) {
  return semanticsLabelMap[semantics] || semantics
}
function actionLabel(action: HealthCenterItem['action']) {
  return action === 'fixable' ? '可一键修复' : action === 'manual' ? '人工决策' : '仅观察'
}

async function refresh(force = false) {
  if (!isLive.value) return
  loading.value = true
  failed.value = false
  try {
    const res = await adminHealthCenterApi.getSummary(force)
    report.value = res.data?.data ?? null
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/* ---------- 跳转（2B 起全部 router 导航；入口卡 → 明细页） ---------- */
function goDrift(kind: keyof HealthDriftSummary) {
  if (kind === 'contract') void router.push('/admin/orchestrator?tab=drift')
  else if (kind === 'hash') void router.push('/admin/skill-workbench')
  else void router.push('/admin/execution-logs')
}
function goSkills() {
  void router.push('/admin/skills')
}

/** manual 项跳对应面板：字段路由/契约维度 → 编排结构漂移 tab；参数/契约/对账类 → Skills；yaml → Skill 工作台 */
function jump(id: HealthCenterItemId) {
  if (id === 'field-routing' || id === 'field-routing-contract' || id === 'fields-sync') void router.push('/admin/orchestrator?tab=drift')
  else if (id === 'yaml-crosscheck' || id === 'params-consistency') void router.push('/admin/skill-workbench')
  else void router.push('/admin/skills')
}

async function fix(id: HealthCenterItemId) {
  const item = displayReport.value?.health.items.find((i) => i.id === id)
  // 安全审计 K-M1：一键修复（编译 core + DB 对账 + 重写 snapshots）执行前二次确认，注明检查项与影响范围
  const ok = await askConfirm({
    title: '一键修复',
    message: `将执行「${item?.label || id}」的自动修复：编译相关 core 文件、执行 DB 对账并重写 agent-snapshots。执行前自动备份、结果写入审计日志。`,
    confirmText: '执行修复',
  })
  if (!ok) return
  fixingId.value = id
  try {
    const res = await adminHealthCenterApi.fix(id)
    const data = res.data?.data
    if (!data) throw new Error('修复响应为空')
    toast.success(data.gitCommitHint)
    // 修复后强制复检并刷新（后端已写审计，缓存已失效）
    await refresh(true)
  } catch (e: any) {
    const hint = e?.response?.data?.error?.fixHint
    toast.error(`修复失败：${errMsg(e)}${hint ? `（${hint}）` : ''}`)
  } finally {
    fixingId.value = null
  }
}

onMounted(() => {
  // ?refresh=1：深链强制重算（避开 60s 缓存）
  const force = route.query.refresh === '1' || route.query.refresh === 'true'
  if (isLive.value) void refresh(force)
})
defineExpose({ refresh })
</script>

<style scoped>
.wb { display: grid; gap: 10px; }
.wb-demo {
  padding: 6px 12px; border: 1px dashed rgba(180, 83, 9, 0.45); border-radius: 10px;
  background: var(--mk-amber-bg); color: var(--mk-amber); font-size: 11.5px; font-weight: 600;
}
.wb-failed {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border: 1px dashed rgba(220, 38, 38, 0.4); border-radius: 10px;
  font-size: 12px; color: var(--mk-red, #dc2626); background: var(--mk-red-bg, #fef2f2);
}
.wb-card { overflow: clip; }
.wb-card .mk-card__head { gap: 6px; }

/* 统计卡（漂移三卡 / 对账六卡 / 完成度五档） */
.wb-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px 12px 12px;
}
.wb-stats--recon { grid-template-columns: repeat(3, 1fr); }
.wb-stats--rec { grid-template-columns: repeat(5, 1fr); }
.wb-stat {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 8px 10px; border: 1px solid var(--mk-line); border-radius: 10px;
  background: var(--mk-surface); text-align: left; font: inherit; cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.wb-stat:hover { border-color: rgba(44, 99, 208, 0.45); background: #f6f9ff; }
.wb-stat--rec { cursor: default; }
.wb-stat--rec:hover { border-color: var(--mk-line); background: var(--mk-surface); }
.wb-stat--alert { border-color: rgba(220, 38, 38, 0.5); background: #fff7f7; }
.wb-stat--alert:hover { border-color: rgba(220, 38, 38, 0.7); }
.wb-stat--live { border-color: rgba(22, 163, 74, 0.35); background: #f6fef9; }
.wb-stat__label { font-size: 11.5px; font-weight: 700; color: var(--mk-muted); }
.wb-stat__num { font-size: 20px; font-weight: 800; line-height: 1.1; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.wb-stat--alert .wb-stat__num { color: var(--mk-red, #dc2626); }
.wb-stat--live .wb-stat__num { color: var(--mk-green, #15803d); }
.wb-stat__go { font-size: 10px; color: var(--mk-faint); }

/* 健康检查 13 项：限高内滚（滚动修复 #2 沿用；为满足 ≤2 屏目标收紧到 48vh） */
.wb-hc-list { display: grid; gap: 6px; max-height: 48vh; overflow-y: auto; overscroll-behavior: contain; padding: 10px 12px 12px; }
.hc-item {
  display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start;
  padding: 9px 12px; border: 1px solid var(--mk-line); border-radius: 10px; background: var(--mk-surface);
}
.hc-item--warn { border-color: rgba(217, 119, 6, 0.4); background: #fffcf5; }
.hc-item--error { border-color: rgba(220, 38, 38, 0.4); background: #fff7f7; }
.hc-item--info { border-style: dashed; background: #fbfcfe; }
.hc-item__dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; }
.hc-item__dot--ok { background: var(--mk-green, #16a34a); }
.hc-item__dot--warn { background: var(--mk-amber, #d97706); }
.hc-item__dot--error { background: var(--mk-red, #dc2626); }
.hc-item__dot--info { background: #94a3b8; }
.hc-item__main { display: grid; gap: 3px; min-width: 0; }
.hc-item__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hc-item__name { font-size: 12.5px; color: var(--mk-ink); }
.hc-item__status { padding: 0 7px; border-radius: 999px; font-size: 10px; font-weight: 800; }
.hc-item--ok .hc-item__status { background: var(--mk-green-bg, #f0fdf4); color: var(--mk-green, #15803d); }
.hc-item--warn .hc-item__status { background: #fef3c7; color: #b45309; }
.hc-item--error .hc-item__status { background: #fee2e2; color: #b91c1c; }
.hc-item--info .hc-item__status { background: #eef2f7; color: #64748b; }
.hc-item__count { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.hc-item__action-tag { font-size: 10px; color: var(--mk-faint); }
.hc-item__sem {
  padding: 0 7px; border-radius: 999px; font-size: 10px; font-weight: 700;
  background: #eef2fa; color: var(--mk-muted);
}
.hc-item__cause { font-size: 11.5px; color: var(--mk-muted); margin: 0; line-height: 1.45; }
.hc-item__detail { font-size: 11px; }
.hc-item__detail summary { cursor: pointer; color: var(--mk-blue); font-weight: 600; }
.hc-item__detail ul { margin: 4px 0 0; padding-left: 16px; display: grid; gap: 2px; color: var(--mk-muted); }
.hc-item__empty { list-style: none; color: var(--mk-faint); }
.hc-item__hint { margin: 2px 0 0; font-size: 10.5px; color: var(--mk-faint); }
.hc-item__ops { display: flex; gap: 6px; align-items: center; }
.hc-btn {
  padding: 4px 12px; border-radius: 999px; border: 1px solid transparent; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
.hc-btn--fix { background: var(--mk-blue); color: #fff; }
.hc-btn--fix:hover { filter: brightness(1.08); }
.hc-btn--fix:disabled { opacity: 0.55; cursor: wait; }
.hc-btn--ghost { background: #fff; border-color: var(--mk-line); color: var(--mk-muted); }
.hc-btn--ghost:hover { color: var(--mk-blue); border-color: rgba(44, 99, 208, 0.4); }
.mono { font-family: var(--mk-mono); font-size: 10.5px; }

@media (min-width: 2000px) {
  .wb-stat__label { font-size: 13px; }
  .wb-stat__num { font-size: 24px; }
  .wb-stat__go { font-size: 12px; }
  .hc-item__name { font-size: 14px; }
  .hc-item__cause { font-size: 13px; }
  .hc-item__detail { font-size: 12.5px; }
  .hc-item__hint, .mono { font-size: 12px; }
  .hc-item__status, .hc-item__sem, .hc-item__action-tag { font-size: 12.5px; }
  .hc-item__count { font-size: 13px; }
  .hc-btn { font-size: 13px; }
  .wb-failed, .wb-demo { font-size: 13px; }
}
</style>

<script lang="ts">
/**
 * demo 模式降级数据：静态演示聚合（与后端 summary 契约同构）。
 * 仅 !isLive 时展示，live 模式失败走 wb-failed 重试，不落此分支。
 */

function demoItem(
  id: HealthCenterItem['id'], label: string, severity: HealthCenterItem['severity'],
  status: HealthCenterItem['status'], count: number, cause: string,
  action: HealthCenterItem['action'], fixHint: string,
  semantics: HealthCenterItem['semantics'] = 'consistency',
  base: HealthCenterItem['base'] = 'bidirectional',
): HealthCenterItem {
  return { id, label, base, semantics, severity, status, count, detail: [], cause, action, fixHint, source: 'demo' }
}

function buildDemoReport(): HealthCenterSummaryReport {
  const items: HealthCenterItem[] = [
    demoItem('w4-corehash', 'W4 漂移（core → 产物 → DB 哈希）', 'error', 'drifted', 2, '核心文件改动后未重新编译同步', 'fixable', '一键修复：编译 + DB 对账 + 重写 snapshots', 'baseline-drift', 'file:core.yaml'),
    demoItem('field-routing-contract', '契约漂移（编排契约 vs DB）', 'error', 'drifted', 1, '编排文件字段路由声明与 DB 台账不一致', 'manual', '人工决策：以文件或 DB 一方为准', 'baseline-drift', 'file:orchestration'),
    demoItem('contract-parity', '契约一致性（manifest ↔ DB 契约元数据）', 'warn', 'unregistered', 1, 'manifest 登记的契约未同步到 DB', 'manual', '在 Skill 目录对账面板核对', 'consistency', 'file:manifest'),
    demoItem('field-routing', '字段路由（字段/路由维度）', 'ok', 'clean', 0, '字段路由声明与 DB 一致', 'none', '', 'consistency', 'file:orchestration'),
    demoItem('snapshots', '沙盘说明书（agent-snapshots.md）', 'ok', 'clean', 0, '快照与渲染产物一致', 'none', '', 'consistency', 'file:core.yaml'),
    demoItem('yaml-crosscheck', 'YAML 交叉校验（参数双写检查）', 'ok', 'clean', 0, '参数双写一致', 'none', '', 'consistency', 'bidirectional'),
    demoItem('params-consistency', '参数一致性（core 与代码声明）', 'ok', 'clean', 0, '参数声明一致', 'none', '', 'consistency', 'bidirectional'),
    demoItem('fields-sync', '字段同步（core 声明 ↔ 编排路由）', 'ok', 'clean', 0, '字段声明同步', 'none', '', 'consistency', 'bidirectional'),
    demoItem('w1-active', 'ACTIVE 检查（W1，双向差集偏户口簿）', 'ok', 'clean', 0, 'ACTIVE prompt 齐备', 'none', '', 'consistency', 'db:managed'),
    demoItem('w2-registration', '注册对账（W2，双向差集偏户口簿）', 'ok', 'clean', 0, '注册表与户口簿一致', 'none', '', 'consistency', 'db:managed'),
    demoItem('w3-wiring', '接线对账（W3，双向对等无派生）', 'ok', 'clean', 0, 'steps 引用与户口簿一致', 'none', '', 'consistency', 'bidirectional'),
    demoItem('override-record', '覆盖行（覆盖权高于文件基准）', 'info', 'none', 0, '无手工覆盖行', 'none', '', 'override-record', 'db:managed'),
    demoItem('runtime-prompt', '运行时漂移（遥测：代码侧 prompt vs DB ACTIVE）', 'warn', 'observed', 1, '遥测观测到代码侧 prompt 与 DB ACTIVE 不一致', 'manual', '在执行日志排查对应调用', 'runtime-info', 'runtime'),
  ]
  return {
    generatedAt: new Date().toISOString(),
    health: {
      summary: { total: items.length, baselineDrift: 2, consistency: 1, overrideRecord: 0, fixable: 1 },
      items,
      abnormal: 4,
    },
    drift: { contract: 1, hash: 2, runtime: 1 },
    reconciliation: {
      total: 8, missingRegistration: 1, zombieRegistration: 0,
      missingActive: 2, zombieActive: 1, zombieSkillActive: 0, unwired: 1,
    },
    completion: {
      distribution: { draft: 2, 'handler-ready': 1, 'core-ready': 1, 'fields-synced': 2, live: 2 },
      live: 2,
    },
    global: { total: 8, aux: 3, mainline: 5, handlerOnly: 0, abnormalSkills: 2 },
  }
}
</script>
