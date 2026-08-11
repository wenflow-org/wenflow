<template>
  <div class="hc">
    <!-- 摘要条 -->
    <div class="hc-bar" :class="`hc-bar--${barTone}`">
      <span class="hc-bar__dot"></span>
      <strong class="hc-bar__title">健康区</strong>
      <span class="hc-bar__meta">{{ summary.total }} 项检查</span>
      <span v-if="report" class="hc-bar__seg">
        <span class="hc-dot hc-dot--error"></span>{{ counts.error }} error
        <span class="hc-dot hc-dot--warn"></span>{{ counts.warn }} warn
        <span class="hc-dot hc-dot--ok"></span>{{ counts.ok }} ok
        <span class="hc-dot hc-dot--info"></span>{{ counts.info }} info
      </span>
      <span v-if="report" class="hc-bar__seg hc-bar__seg--dim">
        基准漂移 {{ summary.baselineDrift }} · 一致性 {{ summary.consistency }} · 覆盖记录 {{ summary.overrideRecord }}
      </span>
      <span v-if="report && summary.fixable > 0" class="hc-bar__fixable">可一键修复 {{ summary.fixable }} 项</span>
      <button type="button" class="hc-bar__action" :disabled="loading" @click="refresh(true)">
        {{ loading ? '检测中…' : '重检' }}
      </button>
    </div>

    <!-- 清单 -->
    <div v-if="report" class="hc-list">
      <div
        v-for="item in report.items"
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

    <div v-else-if="failed" class="hc-failed">健康区加载失败：{{ errMsg }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from '@/utils/toast'
import { errMsg } from './live'
import {
  adminHealthCenterApi,
  type HealthCenterItem,
  type HealthCenterItemId,
  type HealthCenterReport,
} from '@/api/adminApi'

const emit = defineEmits<{ (e: 'jump', target: 'drift' | 'skills' | 'workbench'): void }>()

const report = ref<HealthCenterReport | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const fixingId = ref<HealthCenterItemId | null>(null)

const summary = computed(() => report.value?.summary || { total: 0, baselineDrift: 0, consistency: 0, overrideRecord: 0, fixable: 0 })

/** 客户端聚合严重度计数（服务端 summary 不输出 ok/warn/error 明细） */
const counts = computed(() => {
  const c = { ok: 0, warn: 0, error: 0, info: 0 }
  for (const item of report.value?.items || []) c[item.severity] = (c[item.severity] || 0) + 1
  return c
})

const barTone = computed(() => {
  if (!report.value) return 'muted'
  if (counts.value.error > 0) return 'error'
  if (counts.value.warn > 0) return 'warn'
  return 'ok'
})

const statusLabelMap: Record<string, string> = {
  clean: '干净',
  drifted: '漂移',
  orphan: '孤儿',
  missing: '缺项',
  unregistered: '未注册',
  unwired: '未接线',
  'type-mismatch': '类型不一致',
  'missing-declarations': '缺声明',
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
  loading.value = true
  failed.value = false
  try {
    const res = await adminHealthCenterApi.get(force)
    report.value = res.data?.data ?? null
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/** manual 项跳对应面板：字段路由/合同维度 → drift tab；参数/契约/对账类 → Skills；yaml → Prompt 工作台 */
function jump(id: HealthCenterItemId) {
  if (id === 'field-routing' || id === 'field-routing-contract' || id === 'fields-sync') emit('jump', 'drift')
  else if (id === 'yaml-crosscheck' || id === 'params-consistency') emit('jump', 'workbench')
  else emit('jump', 'skills')
}

async function fix(id: HealthCenterItemId) {
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

onMounted(() => void refresh())
defineExpose({ refresh })
</script>

<style scoped>
.hc { display: grid; gap: 8px; margin-top: 10px; }
.hc-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 12px; border-radius: 10px;
  border: 1px solid var(--mk-line); background: var(--mk-surface);
}
.hc-bar--ok { border-color: rgba(22, 163, 74, 0.35); background: var(--mk-green-bg, #f0fdf4); }
.hc-bar--warn { border-color: rgba(217, 119, 6, 0.4); background: #fffbeb; }
.hc-bar--error { border-color: rgba(220, 38, 38, 0.4); background: var(--mk-red-bg, #fef2f2); }
.hc-bar--muted { opacity: 0.7; }
.hc-bar__dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--mk-blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.15);
}
.hc-bar--ok .hc-bar__dot { background: var(--mk-green, #16a34a); }
.hc-bar--warn .hc-bar__dot { background: var(--mk-amber, #d97706); }
.hc-bar--error .hc-bar__dot { background: var(--mk-red, #dc2626); }
.hc-bar__title { font-size: 13px; color: var(--mk-ink); }
.hc-bar__meta { font-size: 11px; color: var(--mk-faint); }
.hc-bar__seg { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.hc-bar__seg--dim { color: var(--mk-faint); font-size: 10.5px; }
.hc-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-left: 6px; }
.hc-dot--ok { background: var(--mk-green, #16a34a); }
.hc-dot--warn { background: var(--mk-amber, #d97706); }
.hc-dot--error { background: var(--mk-red, #dc2626); }
.hc-dot--info { background: #94a3b8; }
.hc-bar__fixable { font-size: 11px; font-weight: 800; color: var(--mk-red, #dc2626); }
.hc-bar__action {
  margin-left: auto; padding: 3px 12px; border-radius: 999px;
  border: 1px solid var(--mk-line); background: #fff; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 600; color: var(--mk-muted);
}
.hc-bar__action:hover { color: var(--mk-blue); border-color: rgba(52, 120, 246, 0.4); }
.hc-bar__action:disabled { opacity: 0.55; cursor: wait; }

.hc-list { display: grid; gap: 6px; }
.hc-item {
  display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start;
  padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: 10px; background: var(--mk-surface);
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
.hc-btn--ghost:hover { color: var(--mk-blue); border-color: rgba(52, 120, 246, 0.4); }
.hc-failed { padding: 8px 12px; border: 1px dashed rgba(220, 38, 38, 0.4); border-radius: 10px; font-size: 12px; color: var(--mk-red, #dc2626); }
.mono { font-family: var(--mk-mono); font-size: 10.5px; }

@media (min-width: 2000px) {
  .hc-item__name { font-size: 14px; }
  .hc-item__cause { font-size: 13px; }
  .hc-item__detail { font-size: 12.5px; }
  .hc-item__hint, .mono { font-size: 12px; }
  .hc-bar__title { font-size: 15px; }
}
</style>
