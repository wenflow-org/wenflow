<template>
  <div class="learner-models-page">
    <div class="admin-overview-bg">
      <div class="admin-overview-bg__orb admin-overview-bg__orb--1"></div>
      <div class="admin-overview-bg__orb admin-overview-bg__orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title">
        <el-icon class="page-title-icon"><Reading /></el-icon>
        学习者模型
      </h2>
      <p class="page-hero__subtitle">查看和分析用户的学习模型与状态</p>
    </div>

    <div class="toolbar">
      <div class="toolbar-left">
        <el-input v-model="filters.userId" placeholder="按用户 ID 筛选" clearable style="width: 240px" />
        <el-input v-model="filters.pathId" placeholder="按路径 ID 筛选" clearable style="width: 240px" />
        <el-checkbox v-model="filters.riskOnly">仅风险用户</el-checkbox>
        <el-checkbox v-model="filters.staleOnly">仅过期快照</el-checkbox>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetFilters"><el-icon><Refresh /></el-icon>重置</el-button>
      </div>
    </div>

    <div class="table-container">
      <el-table :data="items" stripe v-loading="loading">
        <el-table-column prop="userName" label="用户" min-width="140" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column prop="pathTitle" label="当前路径" min-width="220" show-overflow-tooltip />
        <el-table-column prop="currentMilestone" label="当前阶段" min-width="200" show-overflow-tooltip />
        <el-table-column prop="currentTask" label="当前任务" min-width="180" show-overflow-tooltip />
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
        <el-table-column label="脆弱知识点" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ (row.fragileConcepts || []).join('，') || '无' }}
          </template>
        </el-table-column>
        <el-table-column label="挣扎知识点" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ (row.strugglingConcepts || []).join('，') || '无' }}
          </template>
        </el-table-column>
        <el-table-column label="生成时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.generatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button type="warning" link @click="recompute(row)">重算</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pagination-container">
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
import { Reading, Search, Refresh } from '@element-plus/icons-vue';
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
const formatTime = (value: string) => value ? new Date(value).toLocaleString() : '--';

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

.toolbar { position: relative; z-index: 1; display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; border: 1px solid; border-radius: 18px; backdrop-filter: blur(12px); padding: 16px; }
.toolbar-left { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.toolbar-right { display: flex; gap: 12px; }
.pagination-container { position: relative; z-index: 1; display: flex; justify-content: flex-end; margin-top: 16px; }

[data-theme="dark"] .learner-models-page {
  background: var(--glass-bg-dark);
}

[data-theme="dark"] .toolbar {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}
</style>
