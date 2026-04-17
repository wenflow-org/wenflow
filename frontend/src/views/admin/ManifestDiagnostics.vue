<template>
  <div class="manifest-diagnostics-page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">🧪 架构一致性诊断</h2>
      <p class="page-subtitle">检查 Manifest 与注册表、模型配置、日志、目录之间的漂移</p>
    </div>

    <div class="toolbar">
      <el-button type="primary" :loading="loading" @click="loadData">刷新诊断</el-button>
    </div>

    <div v-if="diagnostics" class="content-grid">
      <el-card class="panel-card" shadow="never">
        <template #header>
          <div class="card-header">总览</div>
        </template>
        <div class="summary-grid">
          <div class="summary-item" v-for="item in summaryItems" :key="item.label">
            <span class="label">{{ item.label }}</span>
            <strong class="value">{{ item.value }}</strong>
          </div>
        </div>
      </el-card>

      <el-card class="panel-card" shadow="never">
        <template #header>
          <div class="card-header">漂移详情</div>
        </template>

        <div class="drift-list">
          <div class="drift-item" v-for="item in driftItems" :key="item.label">
            <div class="drift-head">
              <span class="drift-label">{{ item.label }}</span>
              <el-tag size="small" :type="item.count > 0 ? 'warning' : 'success'">
                {{ item.count }}
              </el-tag>
            </div>

            <el-empty v-if="item.count === 0" :image-size="42" description="无漂移" />

            <div v-else class="chips">
              <el-tag
                v-for="value in item.values.slice(0, 10)"
                :key="`${item.label}-${value}`"
                size="small"
                effect="plain"
              >
                {{ value }}
              </el-tag>
              <span v-if="item.count > 10" class="more">+{{ item.count - 10 }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <el-card class="panel-card" shadow="never">
        <template #header>
          <div class="card-header">Alias 漂移</div>
        </template>

        <el-table :data="aliasRows" size="small" empty-text="无 alias 漂移" stripe>
          <el-table-column prop="type" label="来源" width="120" />
          <el-table-column prop="id" label="发现 ID" min-width="220" />
          <el-table-column prop="canonicalId" label="规范 ID" min-width="220" />
          <el-table-column prop="calls" label="调用数" width="100" />
        </el-table>
      </el-card>

      <el-card class="panel-card" shadow="never">
        <template #header>
          <div class="card-header">样本数据</div>
        </template>
        <div class="sample-grid">
          <div class="sample-item">
            <div class="sample-title">注册表（前 8）</div>
            <div class="chips">
              <el-tag v-for="item in sampleRegistrationIds" :key="item" size="small" effect="plain">{{ item }}</el-tag>
            </div>
          </div>
          <div class="sample-item">
            <div class="sample-title">模型配置（前 8）</div>
            <div class="chips">
              <el-tag v-for="item in sampleModelConfigIds" :key="item" size="small" effect="plain">{{ item }}</el-tag>
            </div>
          </div>
          <div class="sample-item">
            <div class="sample-title">日志 Agent（前 8）</div>
            <div class="chips">
              <el-tag v-for="item in sampleCalledIds" :key="item" size="small" effect="plain">{{ item }}</el-tag>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { adminAgentsApi, type ManifestDiagnosticsData } from '@/api/adminApi';

const loading = ref(false);
const diagnostics = ref<ManifestDiagnosticsData | null>(null);

const summaryItems = computed(() => {
  if (!diagnostics.value) return [];
  const s = diagnostics.value.summary;
  return [
    { label: 'Manifest 实体', value: s.manifestTotal },
    { label: '注册表条目', value: s.registrationTotal },
    { label: '模型配置条目', value: s.modelConfigTotal },
    { label: '日志 Agent 数', value: s.calledAgentTotal },
    { label: '目录条目', value: s.catalogTotal },
    { label: '漂移总数', value: s.driftCount }
  ];
});

const driftItems = computed(() => {
  if (!diagnostics.value) return [];
  const drift = diagnostics.value.drift;
  return [
    { label: '缺失注册', count: drift.missingRegistrations.length, values: drift.missingRegistrations },
    { label: '未知注册', count: drift.unknownRegistrations.length, values: drift.unknownRegistrations },
    { label: '未知模型配置', count: drift.unknownModelConfigs.length, values: drift.unknownModelConfigs },
    { label: '未知日志 Agent', count: drift.unknownLogAgents.length, values: drift.unknownLogAgents },
    { label: '仅目录存在', count: drift.catalogOnly.length, values: drift.catalogOnly }
  ];
});

const aliasRows = computed(() => {
  if (!diagnostics.value) return [];
  const drift = diagnostics.value.drift;
  return [
    ...drift.aliasRegistrations.map(item => ({ type: '注册', id: item.id, canonicalId: item.canonicalId, calls: '-' })),
    ...drift.aliasModelConfigs.map(item => ({ type: '配置', id: item.id, canonicalId: item.canonicalId, calls: '-' })),
    ...drift.aliasLogAgents.map(item => ({ type: '日志', id: item.id, canonicalId: item.canonicalId, calls: item.calls }))
  ];
});

const sampleRegistrationIds = computed(() => diagnostics.value?.samples.registrations.slice(0, 8).map(item => item.id) || []);
const sampleModelConfigIds = computed(() => diagnostics.value?.samples.modelConfigs.slice(0, 8).map(item => item.agentId) || []);
const sampleCalledIds = computed(() => diagnostics.value?.samples.calledAgents.slice(0, 8).map(item => item.agentId) || []);

const loadData = async () => {
  loading.value = true;
  try {
    const res = await adminAgentsApi.getManifestDiagnostics();
    diagnostics.value = res.data?.data || null;
  } catch (error) {
    console.error('加载 manifest 诊断失败:', error);
    ElMessage.error('加载诊断数据失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<style scoped>
.manifest-diagnostics-page {
  padding: 1.25rem;
}

.page-header {
  margin-bottom: 0.9rem;
}

.page-title {
  margin: 0;
  color: var(--text-primary);
}

.page-subtitle {
  margin: 0.4rem 0 0;
  color: var(--text-secondary);
}

.toolbar {
  margin-bottom: 1rem;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 1rem;
}

.panel-card {
  border-radius: var(--radius-xl);
}

.card-header {
  font-weight: 600;
  color: var(--text-primary);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.8rem;
}

.summary-item .label {
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.summary-item .value {
  color: var(--text-primary);
  font-size: 1rem;
}

.drift-list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.drift-item {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 0.75rem;
}

.drift-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.45rem;
}

.drift-label {
  color: var(--text-primary);
  font-weight: 500;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.more {
  color: var(--text-secondary);
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
}

.sample-grid {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.sample-item {
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  padding: 0.7rem;
}

.sample-title {
  color: var(--text-secondary);
  margin-bottom: 0.55rem;
  font-size: 0.88rem;
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
