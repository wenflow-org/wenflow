<template>
  <div class="learner-models-page">
    <div class="admin-overview-bg">
      <div class="admin-overview-bg__orb admin-overview-bg__orb--1"></div>
      <div class="admin-overview-bg__orb admin-overview-bg__orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Reading /></el-icon>
        学习者模型
      </h2>
      <p class="page-hero__subtitle">查看和分析用户的学习模型与状态</p>
    </div>

    <div class="toolbar admin-list-toolbar">
      <div class="toolbar-left admin-list-toolbar__group">
        <el-input v-model="filters.userId" placeholder="按用户 ID 筛选" clearable style="width: 240px" />
        <el-input v-model="filters.pathId" placeholder="按路径 ID 筛选" clearable style="width: 240px" />
        <el-checkbox v-model="filters.riskOnly">仅风险用户</el-checkbox>
        <el-checkbox v-model="filters.staleOnly">仅过期快照</el-checkbox>
      </div>
      <div class="toolbar-right admin-list-toolbar__group">
        <el-button class="learner-btn learner-btn--primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button class="learner-btn learner-btn--ghost" @click="resetFilters"><el-icon><Refresh /></el-icon>重置</el-button>
      </div>
    </div>

    <div class="table-container admin-list-card">
      <el-table :data="items" stripe v-loading="loading">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <strong>{{ row.userName || row.userId || '--' }}</strong>
              <span>{{ row.email || '--' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="学习进度" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="progress-cell">
              <div class="progress-cell__line" :title="row.pathTitle || '--'">路径：{{ row.pathTitle || '--' }}</div>
              <div class="progress-cell__line" :title="row.currentMilestone || '--'">阶段：{{ row.currentMilestone || '--' }}</div>
              <div class="progress-cell__line" :title="row.currentTask || '--'">任务：{{ row.currentTask || '--' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="趋势" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.recentTrend === 'improving' ? 'success' : row.recentTrend === 'declining' ? 'danger' : 'info'">
              {{ trendLabel(row.recentTrend) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="疲劳风险" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.fatigueRisk === 'high' ? 'danger' : row.fatigueRisk === 'medium' ? 'warning' : 'success'">
              {{ riskLabel(row.fatigueRisk) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="风险摘要" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="risk-cell">
              <div class="risk-cell__tags">
                <el-tag size="small" type="info">脆弱 {{ (row.fragileConcepts || []).length }}</el-tag>
                <el-tag size="small" type="warning">挣扎 {{ (row.strugglingConcepts || []).length }}</el-tag>
              </div>
              <div class="risk-cell__text" :title="riskSummary(row)">{{ riskSummary(row) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="生成时间" width="136">
          <template #default="{ row }">
            {{ formatTime(row.generatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right" align="center">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button class="row-action-btn row-action-btn--info" @click="openDetail(row)">详情</el-button>
              <el-dropdown trigger="click" @command="handleOperationCommand($event, row)">
                <el-button class="row-action-btn row-action-btn--more" aria-label="更多操作">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="recompute">重算模型</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pagination-container admin-list-pagination">
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
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Reading, Search, Refresh, MoreFilled } from '@element-plus/icons-vue';
import { adminLearnerModelsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

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

const trendLabel = (value: string) => value === 'improving' ? '上升' : value === 'declining' ? '下降' : '稳定';
const riskLabel = (value: string) => value === 'high' ? '高' : value === 'medium' ? '中' : '低';
const formatTime = (value: string) => {
  if (!value) return '--';
  const date = new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
};

const riskSummary = (row: any) => {
  const fragile = row.fragileConcepts || [];
  const struggling = row.strugglingConcepts || [];
  const merged = [...fragile, ...struggling];
  if (merged.length === 0) return '无明显风险知识点';
  if (merged.length <= 2) return merged.join('，');
  return `${merged.slice(0, 2).join('，')} +${merged.length - 2}`;
};

const handleOperationCommand = async (command: string, row: any) => {
  if (command === 'recompute') {
    await recompute(row);
  }
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
.admin-overview-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.admin-overview-bg__orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.admin-overview-bg__orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: admin-orb 26s ease-in-out infinite; }
.admin-overview-bg__orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: admin-orb 30s ease-in-out infinite reverse; }
@keyframes admin-orb { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.table-container {
  position: relative;
  z-index: 1;
  overflow-x: auto;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(244, 247, 252, 0.72));
  backdrop-filter: blur(12px);
}

.toolbar { position: relative; z-index: 1; display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; border: 1px solid rgba(52, 120, 246, 0.08); border-radius: 18px; backdrop-filter: blur(12px); padding: 16px; background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(244, 247, 252, 0.72)); }
.toolbar-left { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.toolbar-right { display: flex; gap: 12px; }
.pagination-container { position: relative; z-index: 1; display: flex; justify-content: flex-end; margin-top: 16px; }

.learner-btn {
  height: 38px;
  border-radius: 12px;
  font-weight: 600;
  padding: 0 16px;
  border: 1px solid transparent;
}

.learner-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
  box-shadow: 0 10px 20px rgba(52, 120, 246, 0.24);
}

.learner-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.3);
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-action-btn {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
}

.row-action-btn--info {
  color: #2d62cf;
  border-color: rgba(52, 120, 246, 0.25);
  background: rgba(52, 120, 246, 0.1);
}

.row-action-btn--info:hover {
  border-color: rgba(52, 120, 246, 0.45);
  background: rgba(52, 120, 246, 0.16);
}

.row-action-btn--warning {
  color: #8a4f00;
  border-color: rgba(212, 140, 18, 0.28);
  background: rgba(255, 208, 112, 0.24);
}

.row-action-btn--warning:hover {
  border-color: rgba(198, 128, 8, 0.45);
  background: rgba(255, 201, 88, 0.32);
}

.row-action-btn--more {
  min-width: 30px;
  width: 30px;
  padding: 0;
  color: #4d5f86;
  border-color: rgba(77, 95, 134, 0.2);
  background: rgba(246, 248, 253, 0.95);
}

.row-action-btn--more:hover {
  color: #2c3f68;
  border-color: rgba(52, 120, 246, 0.35);
  background: rgba(235, 243, 255, 0.95);
}
</style>
