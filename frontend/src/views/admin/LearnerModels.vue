<template>
  <div class="admin-page learner-models-page">
    <AdminPageHeader
      v-if="!embedded"
      title="学习者模型"
      :icon="Reading"
      :highlights="modelHighlights"
    >
      <template #actions>
        <el-button :loading="loading" @click="loadData">
          <el-icon><Refresh /></el-icon>
          刷新数据
        </el-button>
      </template>
    </AdminPageHeader>

    <div class="admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="filters.userId" placeholder="按用户 ID 筛选" clearable style="width: 200px" @input="handleSearch" />
        <el-input v-model="filters.pathId" placeholder="按路径 ID 筛选" clearable style="width: 200px" @input="handleSearch" />
        <el-checkbox v-model="filters.riskOnly" @change="handleSearch">仅风险用户</el-checkbox>
        <el-checkbox v-model="filters.staleOnly" @change="handleSearch">仅过期快照</el-checkbox>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button @click="resetFilters">
          <el-icon><RefreshLeft /></el-icon>
          重置
        </el-button>
      </div>
    </div>

    <section v-if="showEmptyState" class="empty-state-card admin-list-card">
      <div class="empty-state-card__copy">
        <span class="empty-state-card__eyebrow">学习者快照</span>
        <h3>{{ emptyStateTitle }}</h3>
        <p>{{ emptyStateDescription }}</p>
      </div>
      <div class="empty-state-card__actions">
        <el-button type="primary" @click="loadData">
          重新加载
        </el-button>
        <el-button @click="resetFilters">
          清空筛选
        </el-button>
      </div>
      <div class="empty-state-card__tips">
        <article class="empty-tip">
          <strong>为什么会为空</strong>
          <span>还没有生成学习者快照，或者当前筛选条件把结果收窄到了 0 条。</span>
        </article>
        <article class="empty-tip">
          <strong>建议下一步</strong>
          <span>先去教学会话或虚拟学习者页跑一次真实流程，再回来查看模型快照。</span>
        </article>
      </div>
    </section>

    <div v-else class="table-container admin-list-card">
      <el-table :data="items" stripe v-loading="loading">
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">
            <div class="user-cell">
              <strong>{{ row.userName || row.userId || '--' }}</strong>
              <span>{{ row.email || '--' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="学习进度" min-width="320">
          <template #default="{ row }">
            <div class="progress-cell">
              <div class="progress-cell__line">路径：{{ truncateText(row.pathTitle, 28) }}</div>
              <div class="progress-cell__line">阶段：{{ truncateText(row.currentMilestone, 28) }}</div>
              <div class="progress-cell__line">任务：{{ truncateText(row.currentTask, 28) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="92" align="center">
          <template #default="{ row }">
            <div class="status-cell">
              <el-tag size="small" :type="row.recentTrend === 'improving' ? 'success' : row.recentTrend === 'declining' ? 'danger' : 'info'">
                {{ trendLabel(row.recentTrend) }}
              </el-tag>
              <el-tag size="small" :type="row.fatigueRisk === 'high' ? 'danger' : row.fatigueRisk === 'medium' ? 'warning' : 'success'">
                {{ riskLabel(row.fatigueRisk) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="风险摘要" min-width="220">
          <template #default="{ row }">
            <div class="risk-cell">
              <div class="risk-cell__tags">
                <el-tag size="small" type="info">脆弱 {{ (row.fragileConcepts || []).length }}</el-tag>
                <el-tag size="small" type="warning">挣扎 {{ (row.strugglingConcepts || []).length }}</el-tag>
              </div>
              <div class="risk-cell__text">{{ riskSummary(row) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="110">
          <template #default="{ row }">
            {{ formatRelativeTime(row.generatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="128" fixed="right" align="center">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button class="model-action-btn" @click="openDetail(row)">详情</el-button>
              <el-button class="model-action-btn model-action-btn--ghost" @click="recompute(row)">重算</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="pagination.total > 0" class="pagination-container admin-list-pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @size-change="handleSizeChange"
        @current-change="loadData"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Reading, Refresh, RefreshLeft } from '@element-plus/icons-vue';
import { adminLearnerModelsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';
import AdminPageHeader from './components/AdminPageHeader.vue';

withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
});

const router = useRouter();
const loading = ref(false);
const items = ref<any[]>([]);

const filters = reactive({
  userId: '',
  pathId: '',
  riskOnly: false,
  staleOnly: false,
});

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
});

const showEmptyState = computed(() => !loading.value && items.value.length === 0);

const hasFiltersApplied = computed(() => {
  return Boolean(filters.userId || filters.pathId || filters.riskOnly || filters.staleOnly);
});

const riskCount = computed(() => items.value.filter((item) => item.riskLevel === 'high' || item.riskLevel === 'medium').length);
const staleCount = computed(() => items.value.filter((item) => {
  if (!item.lastUpdatedAt) return false;
  const diffMs = Date.now() - new Date(item.lastUpdatedAt).getTime();
  return diffMs > 7 * 86400000; // 7天
}).length);

const modelHighlights = computed(() => [
  { label: `${pagination.total} 个快照`, tone: 'info' as const },
  { label: `${riskCount.value} 个风险用户`, tone: riskCount.value > 0 ? 'danger' as const : 'neutral' as const },
  { label: `${staleCount.value} 个过期快照`, tone: staleCount.value > 0 ? 'warning' as const : 'neutral' as const },
  { label: hasFiltersApplied.value ? '筛选已启用' : '查看全部', tone: hasFiltersApplied.value ? 'success' as const : 'neutral' as const },
]);

const emptyStateTitle = computed(() => {
  return hasFiltersApplied.value ? '当前筛选下没有匹配的学习者快照' : '还没有可展示的学习者模型';
});

const emptyStateDescription = computed(() => {
  return hasFiltersApplied.value
    ? '放宽筛选条件后再试。'
    : '学习轨迹累积后自动生成。';
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;

const handleSearch = () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadData();
  }, 300);
};

const trendLabel = (value?: string) => value === 'improving' ? '上升' : value === 'declining' ? '下降' : '稳定';
const riskLabel = (value?: string) => value === 'high' ? '高' : value === 'medium' ? '中' : '低';

const truncateText = (text: string | undefined, maxLen: number) => {
  if (!text) return '--';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
};

const formatRelativeTime = (value: string) => {
  if (!value) return '--';
  const now = new Date();
  const date = new Date(value);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
};

const riskSummary = (row: any) => {
  const fragile = row.fragileConcepts || [];
  const struggling = row.strugglingConcepts || [];
  const merged = [...fragile, ...struggling];
  if (merged.length === 0) return '无明显风险知识点';
  if (merged.length <= 2) return merged.join('，');
  return `${merged.slice(0, 2).join('，')} +${merged.length - 2}`;
};

const handleSizeChange = () => {
  pagination.page = 1;
  loadData();
};

const loadData = async () => {
  loading.value = true;
  try {
    const res: any = await adminLearnerModelsApi.list({
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
    });
    const data = res.data?.data || res.data || {};
    items.value = data.items || [];
    pagination.total = data.total || 0;
  } catch (error) {
    console.error(error);
    toast.error('加载学习者模型失败');
  } finally {
    loading.value = false;
  }
};

const resetFilters = () => {
  filters.userId = '';
  filters.pathId = '';
  filters.riskOnly = false;
  filters.staleOnly = false;
  pagination.page = 1;
  loadData();
};

const openDetail = (row: any) => {
  router.push({
    name: 'AdminLearnerModelDetail',
    params: { userId: row.userId },
    query: row.pathId ? { pathId: row.pathId } : undefined,
  });
};

const recompute = async (row: any) => {
  try {
    await adminLearnerModelsApi.recompute(row.userId, {
      pathId: row.pathId || undefined,
      scope: row.pathId ? 'path' : 'global',
    });
    toast.success('学习者模型已重算');
    loadData();
  } catch (error) {
    console.error(error);
    toast.error('重算失败');
  }
};

onMounted(loadData);
</script>

<style scoped>
.learner-models-page {
  display: grid;
  gap: 16px;
}

.module-head {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: var(--admin-border-subtle);
}

.module-head__copy {
  display: grid;
  gap: 6px;
}

.module-head__copy h2 {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.25;
  color: var(--admin-text-primary);
}

.table-container {
  position: relative;
  overflow-x: auto;
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  background: var(--admin-bg-surface);
  box-shadow: none;
  padding: 0;
}

.pagination-container {
  position: relative;
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.empty-state-card {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 18px;
  padding: 28px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.94));
  box-shadow: 0 18px 36px rgba(31, 87, 204, 0.08);
}

.empty-state-card__copy {
  display: grid;
  gap: 8px;
  max-width: 680px;
}

.empty-state-card__copy h3 {
  margin: 0;
  font-size: 1.4rem;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.empty-state-card__copy p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-secondary);
}

.empty-state-card__eyebrow {
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: var(--color-primary-dark, #1f57cc);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
}

.empty-state-card__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.empty-state-card__tips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.empty-tip {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.76);
}

.empty-tip strong {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.empty-tip span {
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.55;
}

.learner-btn--ghost {
  color: #335aa4;
  border-color: rgba(52, 120, 246, 0.26);
  background: rgba(255, 255, 255, 0.85);
}

.learner-btn--ghost:hover {
  color: #22478f;
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(238, 245, 255, 0.92);
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

/* 固定列在浮动时需要背景，继承表格单元格的背景 */
:deep(.el-table__fixed-right .el-table__row .el-table__cell) {
  background-color: #ffffff;
}

/* 保持斑马纹效果 */
:deep(.el-table__fixed-right .el-table__row.el-table__row--striped .el-table__cell) {
  background-color: #fafafa;
}

/* 保持hover效果 */
:deep(.el-table__fixed-right .el-table__row:hover .el-table__cell) {
  background-color: rgba(52, 120, 246, 0.03) !important;
}

.model-action-btn {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
  color: var(--color-primary-dark, #1f57cc);
  font-size: 0.8125rem;
  font-weight: 700;
}

.model-action-btn:hover {
  border-color: rgba(52, 120, 246, 0.3);
  background: rgba(236, 244, 255, 0.98);
  color: var(--color-primary-dark, #1f57cc);
}

.model-action-btn--ghost {
  background: rgba(255, 255, 255, 0.92);
}

.status-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.user-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.user-cell strong {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.2;
}

.user-cell span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.progress-cell__line {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-secondary);
  word-break: break-word;
}

.risk-cell {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.risk-cell__tags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.risk-cell__text {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
}

:deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
}

:deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

@media (max-width: 768px) {
  .empty-state-card {
    padding: 22px 18px;
  }

  .empty-state-card__tips {
    grid-template-columns: 1fr;
  }
}
</style>
