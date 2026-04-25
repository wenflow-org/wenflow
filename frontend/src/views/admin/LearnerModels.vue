<template>
  <div class="learner-models-page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">学习者模型</h2>
      <p class="page-subtitle">查看学习者快照、风险信号与当前路径位置</p>
    </div>

    <div class="toolbar">
      <div class="toolbar-left">
        <el-input v-model="filters.userId" placeholder="按用户 ID 筛选" clearable style="width: 240px" />
        <el-input v-model="filters.pathId" placeholder="按路径 ID 筛选" clearable style="width: 240px" />
        <el-checkbox v-model="filters.riskOnly">仅风险用户</el-checkbox>
        <el-checkbox v-model="filters.staleOnly">仅过期快照</el-checkbox>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="loadData">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </div>

    <el-table :data="items" stripe>
      <el-table-column prop="userName" label="用户" min-width="140" />
      <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
      <el-table-column prop="pathTitle" label="当前路径" min-width="180" show-overflow-tooltip />
      <el-table-column prop="currentMilestone" label="当前阶段" min-width="160" show-overflow-tooltip />
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
          <el-button link @click="recompute(row)">重算</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @size-change="loadData"
        @current-change="loadData"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { adminLearnerModelsApi } from '@/api/adminApi';

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
    ElMessage.error('加载学习者模型失败');
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
    ElMessage.success('学习者模型已重算');
    loadData();
  } catch (error) {
    console.error(error);
    ElMessage.error('重算失败');
  }
};

onMounted(loadData);
</script>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-title { margin: 0; font-size: 24px; font-weight: 700; }
.page-subtitle { margin: 8px 0 0; color: var(--text-secondary); }
.toolbar { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar-left { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.toolbar-right { display: flex; gap: 12px; }
.pagination-container { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
