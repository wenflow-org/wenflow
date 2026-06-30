<template>
  <div class="regression-compare-page">
    <header class="regression-compare-header">
      <div class="regression-compare-header__inner">
        <button type="button" class="regression-compare-brand" @click="router.push('/admin/test/dashboard')">
          <span>回归对比</span>
        </button>
        <div class="regression-compare-header__actions">
          <button class="regression-compare-btn" @click="router.back()">返回</button>
        </div>
      </div>
    </header>

    <main class="regression-compare-shell">
      <div v-if="loading" class="regression-compare-empty">加载中...</div>
      <div v-else-if="error" class="regression-compare-empty">{{ error }}</div>
      <section v-else class="regression-compare-cards">
        <div class="regression-compare-summary">
          <h2>Session 对比</h2>
          <div class="regression-compare-chips">
            <span class="regression-compare-chip" :class="diffChipClass('goalRounds')">
              Goal 轮数: {{ metricsA.goalRounds }} → {{ metricsB.goalRounds }}
            </span>
            <span class="regression-compare-chip" :class="diffChipClass('pathMilestones')">
              Path 阶段: {{ metricsA.pathMilestones }} → {{ metricsB.pathMilestones }}
            </span>
            <span class="regression-compare-chip" :class="diffChipClass('reviewDecision')">
              评估: {{ metricsA.reviewDecision || '--' }} → {{ metricsB.reviewDecision || '--' }}
            </span>
            <span class="regression-compare-chip" :class="diffChipClass('learningTasksCompleted')">
              Learn 完成: {{ metricsA.learningTasksCompleted }}/{{ metricsA.learningTotalTasks }} → {{ metricsB.learningTasksCompleted }}/{{ metricsB.learningTotalTasks }}
            </span>
            <span class="regression-compare-chip" :class="diffChipClass('duration')" v-if="metricsA.duration && metricsB.duration">
              耗时: {{ fmtDuration(metricsA.duration) }} → {{ fmtDuration(metricsB.duration) }}
            </span>
          </div>
        </div>

        <div class="regression-compare-grid">
          <div class="regression-compare-col">
            <div class="regression-compare-col__head">
              <span>Session A</span>
              <strong>{{ sessionA?.id?.slice(0, 20) }}...</strong>
            </div>
            <div class="regression-compare-kv">
              <div><span>Status</span><strong>{{ sessionA?.status }}</strong></div>
              <div><span>Stage</span><strong>{{ sessionA?.currentStage }}</strong></div>
              <div><span>Goal Rounds</span><strong>{{ metricsA.goalRounds }}</strong></div>
              <div><span>Goal Final Stage</span><strong>{{ metricsA.goalFinalStage || '--' }}</strong></div>
              <div><span>Path Milestones</span><strong>{{ metricsA.pathMilestones }}</strong></div>
              <div><span>Review Decision</span><strong>{{ metricsA.reviewDecision || '--' }}</strong></div>
              <div><span>Review Reaction</span><strong class="wrap">{{ metricsA.reviewReaction || '--' }}</strong></div>
              <div><span>Learn Tasks</span><strong>{{ metricsA.learningTasksCompleted }}/{{ metricsA.learningTotalTasks }}</strong></div>
              <div><span>Overrides</span><strong>{{ fmtOverrides(metricsA.overrides) }}</strong></div>
            </div>
          </div>

          <div class="regression-compare-col">
            <div class="regression-compare-col__head regression-compare-col__head--b">
              <span>Session B</span>
              <strong>{{ sessionB?.id?.slice(0, 20) }}...</strong>
            </div>
            <div class="regression-compare-kv">
              <div><span>Status</span><strong>{{ sessionB?.status }}</strong></div>
              <div><span>Stage</span><strong>{{ sessionB?.currentStage }}</strong></div>
              <div><span>Goal Rounds</span><strong>{{ metricsB.goalRounds }}</strong></div>
              <div><span>Goal Final Stage</span><strong>{{ metricsB.goalFinalStage || '--' }}</strong></div>
              <div><span>Path Milestones</span><strong>{{ metricsB.pathMilestones }}</strong></div>
              <div><span>Review Decision</span><strong>{{ metricsB.reviewDecision || '--' }}</strong></div>
              <div><span>Review Reaction</span><strong class="wrap">{{ metricsB.reviewReaction || '--' }}</strong></div>
              <div><span>Learn Tasks</span><strong>{{ metricsB.learningTasksCompleted }}/{{ metricsB.learningTotalTasks }}</strong></div>
              <div><span>Overrides</span><strong>{{ fmtOverrides(metricsB.overrides) }}</strong></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from '@/utils/toast'
import { adminApi } from '@/api/adminApi'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const sessionA = ref<any>(null)
const sessionB = ref<any>(null)
const metricsA = ref<any>({})
const metricsB = ref<any>({})

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function fmtOverrides(overrides: any) {
  if (!overrides) return '默认'
  const parts: string[] = []
  if (overrides.goalAgent) parts.push('Goal: 自定义')
  if (overrides.pathAgent) parts.push('Path: 自定义')
  return parts.length > 0 ? parts.join(', ') : '默认'
}

function diffChipClass(field: string) {
  const a = metricsA.value[field]
  const b = metricsB.value[field]
  if (a === b) return ''
  return 'regression-compare-chip--changed'
}

onMounted(async () => {
  const sessionIdA = route.query.sessionA as string
  const sessionIdB = route.query.sessionB as string

  if (!sessionIdA || !sessionIdB) {
    error.value = '缺少 sessionA 或 sessionB 参数'
    loading.value = false
    return
  }

  try {
    const result = await adminApi.compareSessions(sessionIdA, sessionIdB)
    if (result?.data?.success || result?.success) {
      sessionA.value = result.data?.sessionA || result.data?.data?.sessionA
      sessionB.value = result.data?.sessionB || result.data?.data?.sessionB
      metricsA.value = sessionA.value
      metricsB.value = sessionB.value
    } else {
      error.value = '加载对比数据失败'
    }
  } catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '加载失败'
    toast.error(error.value)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.regression-compare-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
  color: #172033;
}

.regression-compare-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(205, 216, 238, 0.9);
}

.regression-compare-header__inner,
.regression-compare-shell {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.regression-compare-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.regression-compare-brand {
  font-weight: 900;
  font-size: 18px;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.regression-compare-btn {
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.regression-compare-shell {
  padding: 24px 0 72px;
}

.regression-compare-empty {
  min-height: 200px;
  display: grid;
  place-items: center;
}

.regression-compare-summary {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 22px;
  padding: 20px 24px;
  margin-bottom: 20px;
}

.regression-compare-summary h2 {
  margin: 0 0 14px;
  font-size: 20px;
}

.regression-compare-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.regression-compare-chip {
  display: inline-flex;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
  font-size: 13px;
  font-weight: 700;
}

.regression-compare-chip--changed {
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.regression-compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.regression-compare-col {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 22px;
  overflow: hidden;
}

.regression-compare-col__head {
  padding: 18px 20px;
  border-bottom: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), transparent);
}

.regression-compare-col__head--b {
  background: linear-gradient(135deg, rgba(141, 107, 255, 0.06), transparent);
}

.regression-compare-col__head span {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.regression-compare-col__head--b span {
  background: rgba(141, 107, 255, 0.12);
  color: #6c4dda;
}

.regression-compare-col__head strong {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  word-break: break-all;
}

.regression-compare-kv {
  padding: 16px 20px;
  display: grid;
  gap: 12px;
}

.regression-compare-kv > div {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.regression-compare-kv span {
  color: #66758d;
  font-size: 12px;
  font-weight: 700;
  min-width: 90px;
}

.regression-compare-kv strong {
  color: #172033;
  font-size: 13px;
  text-align: right;
}

.regression-compare-kv strong.wrap {
  max-width: 280px;
  word-break: break-word;
  text-align: right;
}
</style>
