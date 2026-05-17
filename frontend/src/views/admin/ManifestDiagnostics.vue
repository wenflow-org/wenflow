<template>
  <div class="manifest-diagnostics-page" v-loading="loading">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>

    <div class="page-hero">
      <span class="pill">高级诊断</span>
      <h2 class="page-hero__title">
        <el-icon class="page-hero__icon"><WarningFilled /></el-icon>
        Agent 架构诊断
      </h2>
      <p class="page-hero__subtitle">用于排查 manifest、注册表、模型配置与日志协议漂移（工程治理）</p>
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
          <div class="card-header">输出协议健康度</div>
        </template>

        <el-table :data="outputContractRows" size="small" empty-text="暂无输出协议样本" stripe>
          <el-table-column prop="source" label="来源" min-width="160" />
          <el-table-column prop="sampleSize" label="样本数" width="90" />
          <el-table-column label="v1" width="130">
            <template #default="scope">
              <el-tag size="small" type="success">{{ scope.row.v1 }} ({{ formatRatio(scope.row.v1, scope.row.sampleSize) }})</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="legacy" width="130">
            <template #default="scope">
              <el-tag size="small" :type="scope.row.legacy > 0 ? 'warning' : 'success'">
                {{ scope.row.legacy }} ({{ formatRatio(scope.row.legacy, scope.row.sampleSize) }})
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="mixed" width="130">
            <template #default="scope">
              <el-tag size="small" :type="scope.row.mixed > 0 ? 'warning' : 'success'">
                {{ scope.row.mixed }} ({{ formatRatio(scope.row.mixed, scope.row.sampleSize) }})
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="unknown" width="130">
            <template #default="scope">
              <el-tag size="small" :type="scope.row.unknown > 0 ? 'danger' : 'success'">
                {{ scope.row.unknown }} ({{ formatRatio(scope.row.unknown, scope.row.sampleSize) }})
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
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
    <div v-else-if="!loading" class="empty-state">
      <el-empty description="暂无诊断数据，请点击刷新" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import { adminAgentsApi, type ManifestDiagnosticsData } from '@/api/adminApi';
import { toast } from '../../utils/toast';

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
    { label: '日志输出样本', value: s.outputContractSampleSize ?? 0 },
    { label: '漂移总数', value: s.driftCount }
  ];
});

const outputContractRows = computed(() => {
  if (!diagnostics.value?.outputContracts) return [];
  return [
    {
      source: 'agent_call_logs',
      ...diagnostics.value.outputContracts.agentCallLogs
    }
  ];
});

const formatRatio = (value: number, total: number) => {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
};

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
    toast.error('加载诊断数据失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<style scoped>
.manifest-diagnostics-page {
  padding: 0;
  position: relative;
}

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; display: inline-flex; align-items: center; gap: 0.5rem; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.page-hero__icon { color: var(--color-primary); }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.toolbar {
  margin-bottom: 1rem;
  position: relative;
  z-index: 1;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 1rem;
  position: relative;
  z-index: 1;
}

/* Panel glass cards */
.panel-card {
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
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
  border-left: 3px solid var(--color-primary);
  border-radius: var(--fluent-radius-md);
  padding: 0.65rem 0.8rem;
  transition: border-color 0.2s;
}

.summary-item:hover {
  border-left-color: rgba(52, 120, 246, 0.5);
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
  border-radius: var(--fluent-radius-md);
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
  border-radius: var(--fluent-radius-md);
  padding: 0.7rem;
}

.sample-title {
  color: var(--text-secondary);
  margin-bottom: 0.55rem;
  font-size: 0.88rem;
}

/* Table deep overrides */
.panel-card :deep(.el-table) {
  border-radius: 12px;
  overflow: hidden;
}

.panel-card :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.04);
  font-weight: 600;
  font-size: 0.8125rem;
}

.panel-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(141, 107, 255, 0.02);
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
