<template>
  <div class="admin-page path-events-page">
    <AdminPageHeader title="流程事件" :icon="Connection" :highlights="eventHighlights">
      <template #actions>
        <el-button type="primary" :loading="loading" @click="loadEvents">刷新</el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-summary-grid" v-if="summary.total > 0">
      <article class="admin-summary-card admin-summary-card--blue">
        <div class="admin-summary-card__label">事件总数</div>
        <strong class="admin-summary-card__value">{{ summary.total }}</strong>
        <div class="events-summary-meta">当前结果集</div>
      </article>
      <article class="admin-summary-card admin-summary-card--green">
        <div class="admin-summary-card__label">成功</div>
        <strong class="admin-summary-card__value">{{ summary.success }}</strong>
        <div class="events-summary-meta">已完成阶段</div>
      </article>
      <article class="admin-summary-card admin-summary-card--orange">
        <div class="admin-summary-card__label">进行中</div>
        <strong class="admin-summary-card__value">{{ summary.running }}</strong>
        <div class="events-summary-meta">started</div>
      </article>
      <article class="admin-summary-card admin-summary-card--red">
        <div class="admin-summary-card__label">失败</div>
        <strong class="admin-summary-card__value">{{ summary.failed }}</strong>
        <div class="events-summary-meta">需处理</div>
      </article>
    </section>

    <section class="admin-filter-panel">
      <div class="admin-section-head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">流程筛选</h3>
        </div>
      </div>
      <div class="admin-filter-grid admin-filter-grid--wide">
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">Path ID</label>
          <el-input v-model="filters.pathId" placeholder="pathId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">Trace ID</label>
          <el-input v-model="filters.traceId" placeholder="traceId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">阶段</label>
          <el-select v-model="filters.phase" placeholder="全部阶段" clearable class="filter-select">
            <el-option label="core" value="core" />
            <el-option label="stageDesign" value="stageDesign" />
          </el-select>
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">状态</label>
          <el-select v-model="filters.status" placeholder="全部状态" clearable class="filter-select">
            <el-option label="started" value="started" />
            <el-option label="succeeded" value="succeeded" />
            <el-option label="failed" value="failed" />
          </el-select>
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">数量</label>
          <el-select v-model="filters.limit" class="filter-select">
            <el-option :value="20" label="20 条" />
            <el-option :value="50" label="50 条" />
            <el-option :value="100" label="100 条" />
          </el-select>
        </div>
        <div class="filter-actions">
          <el-button type="primary" :loading="loading" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </div>
      </div>
    </section>

    <section class="logs-shell">
      <div class="admin-section-head logs-shell__head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">阶段事件流</h3>
        </div>
      </div>
      <div class="logs-shell__toolbar">
        <span class="logs-shell__count">{{ events.length }} 条结果</span>
        <p class="logs-shell__note">{{ activeFilterLabel }}</p>
      </div>
      <div class="logs-list" v-loading="loading">
        <article v-for="event in events" :key="event.id" class="event-card" @click="openDetail(event)">
          <div class="event-card__main">
            <div class="event-card__primary">
              <span class="event-card__time">{{ formatTime(event.createdAt) }}</span>
              <strong class="event-card__phase">{{ event.phase || 'unknown' }}</strong>
              <el-tag size="small" :type="statusTagType(event.status)">{{ event.status || 'unknown' }}</el-tag>
            </div>
            <div class="event-card__secondary">
              <span v-if="event.pathId">Path {{ event.pathId }}</span>
              <span v-if="event.triggerSource">来源 {{ event.triggerSource }}</span>
              <span v-if="event.traceId">Trace {{ event.traceId }}</span>
            </div>
          </div>
          <div class="event-card__aside">
            <span class="event-card__duration">{{ formatDuration(event.durationMs) }}</span>
            <el-button type="primary" link size="small">详情</el-button>
          </div>
        </article>
        <el-empty v-if="!loading && events.length === 0" description="暂无流程事件" />
      </div>
    </section>

    <el-drawer v-model="detailVisible" size="min(72%, 960px)" destroy-on-close>
      <template #header>
        <div class="detail-header">
          <strong>{{ selectedEvent?.phase || '流程事件' }}</strong>
          <span>{{ selectedEvent?.id || '' }}</span>
        </div>
      </template>

      <div v-if="selectedEvent" class="detail-body">
        <div class="detail-overview-grid">
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">状态</span>
            <strong>{{ selectedEvent.status || 'unknown' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">Path</span>
            <strong>{{ selectedEvent.pathId || '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">Trace</span>
            <strong>{{ selectedEvent.traceId || '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">耗时</span>
            <strong>{{ formatDuration(selectedEvent.durationMs) }}</strong>
          </div>
        </div>

        <el-tabs>
          <el-tab-pane label="输入">
            <pre>{{ selectedEvent.input || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="输出">
            <pre>{{ selectedEvent.output || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="元数据">
            <pre>{{ JSON.stringify(selectedEvent.metadata, null, 2) }}</pre>
          </el-tab-pane>
          <el-tab-pane label="错误">
            <pre>{{ selectedEvent.error || '--' }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Connection } from '@element-plus/icons-vue'
import { adminRuntimeDefinitionsApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'
import { toast } from '@/utils/toast'

interface PathGenerationEvent {
  id: string
  traceId?: string | null
  userId?: string | null
  agentId?: string | null
  sourceEntry?: string | null
  phase?: string | null
  status?: string | null
  pathId?: string | null
  sourceConversationId?: string | null
  triggerSource?: string | null
  durationMs: number
  success: boolean
  error?: string | null
  errorCode?: string | null
  input?: string | null
  output?: string | null
  createdAt: string
  metadata?: Record<string, any>
}

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const events = ref<PathGenerationEvent[]>([])
const summary = ref({ total: 0, success: 0, failed: 0, running: 0 })
const detailVisible = ref(false)
const selectedEvent = ref<PathGenerationEvent | null>(null)
const filters = ref({
  pathId: '',
  traceId: '',
  phase: '',
  status: '',
  limit: 50,
})

const eventHighlights = computed(() => [
  { label: `${summary.value.total} 条事件`, tone: 'info' as const },
  { label: `成功 ${summary.value.success}`, tone: 'success' as const },
  { label: `进行中 ${summary.value.running}`, tone: 'warning' as const },
  { label: `失败 ${summary.value.failed}`, tone: summary.value.failed > 0 ? 'danger' as const : 'neutral' as const },
])

const activeFilterLabel = computed(() => {
  const parts = [
    filters.value.pathId ? `Path ${filters.value.pathId}` : '',
    filters.value.traceId ? `Trace ${filters.value.traceId}` : '',
    filters.value.phase ? `阶段 ${filters.value.phase}` : '',
    filters.value.status ? `状态 ${filters.value.status}` : '',
  ].filter(Boolean)
  return parts.length ? `当前筛选：${parts.join(' / ')}` : '默认范围'
})

const syncRouteQuery = () => {
  const query: Record<string, string> = {}
  if (filters.value.pathId.trim()) query.pathId = filters.value.pathId.trim()
  if (filters.value.traceId.trim()) query.traceId = filters.value.traceId.trim()
  if (filters.value.phase.trim()) query.phase = filters.value.phase.trim()
  if (filters.value.status.trim()) query.status = filters.value.status.trim()
  if (filters.value.limit !== 50) query.limit = String(filters.value.limit)
  router.replace({ query })
}

const hydrateFiltersFromRoute = () => {
  filters.value.pathId = typeof route.query.pathId === 'string' ? route.query.pathId : ''
  filters.value.traceId = typeof route.query.traceId === 'string' ? route.query.traceId : ''
  filters.value.phase = typeof route.query.phase === 'string' ? route.query.phase : ''
  filters.value.status = typeof route.query.status === 'string' ? route.query.status : ''
  filters.value.limit = typeof route.query.limit === 'string' && Number.isFinite(Number(route.query.limit))
    ? Number(route.query.limit)
    : 50
}

const loadEvents = async () => {
  loading.value = true
  try {
    const response = await adminRuntimeDefinitionsApi.getPathGenerationEvents({
      limit: filters.value.limit,
      pathId: filters.value.pathId || undefined,
      traceId: filters.value.traceId || undefined,
      phase: filters.value.phase || undefined,
      status: filters.value.status || undefined,
    })
    events.value = response.data?.data?.events || []
    summary.value = response.data?.data?.summary || { total: 0, success: 0, failed: 0, running: 0 }
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载流程事件失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  syncRouteQuery()
  loadEvents()
}

const handleReset = () => {
  filters.value = {
    pathId: '',
    traceId: '',
    phase: '',
    status: '',
    limit: 50,
  }
  syncRouteQuery()
  loadEvents()
}

const openDetail = (event: PathGenerationEvent) => {
  selectedEvent.value = event
  detailVisible.value = true
}

const statusTagType = (status?: string | null) => {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'started') return 'warning'
  return 'info'
}

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN')
const formatDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

onMounted(() => {
  hydrateFiltersFromRoute()
  loadEvents()
})
</script>

<style scoped>
.path-events-page {
  display: grid;
  gap: 14px;
}

.events-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.logs-shell {
  display: grid;
  gap: 14px;
}

.logs-shell__toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.logs-shell__count,
.logs-shell__note {
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.event-card {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 14px;
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface);
  cursor: pointer;
}

.event-card:hover {
  border-color: rgba(52, 120, 246, 0.18);
}

.event-card__main,
.event-card__aside {
  display: grid;
  gap: 6px;
}

.event-card__primary,
.event-card__secondary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.event-card__time,
.event-card__secondary,
.event-card__duration {
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.event-card__phase {
  color: var(--admin-text-primary);
}

.detail-header {
  display: grid;
  gap: 4px;
}

.detail-body {
  display: grid;
  gap: 16px;
}

.detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.detail-overview-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 12px;
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface-alt);
}

.detail-overview-card__label {
  font-size: 12px;
  color: var(--admin-text-muted);
}

pre {
  margin: 0;
  padding: 14px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
}

@media (max-width: 960px) {
  .detail-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
