<template>
  <div class="admin-page manifest-diagnostics-page" v-loading="loading">
    <AdminPageHeader
      kicker="Architecture Diagnostics"
      title="Agent 架构诊断"
      desc="排查 manifest、注册表和协议漂移。"
      :icon="WarningFilled"
      :highlights="manifestHighlights"
    >
      <template #actions>
        <el-button type="primary" :loading="loading" @click="loadData">刷新诊断</el-button>
      </template>
    </AdminPageHeader>

    <section class="manifest-intro">
      <div class="manifest-intro__copy">
        <span class="manifest-intro__kicker">Diagnostic Scope</span>
        <h3>工程诊断总览</h3>
        <p>统一查看 manifest、注册表、模型配置和日志样本之间的结构漂移。</p>
      </div>
      <div class="manifest-intro__stats">
        <article class="manifest-intro-card">
          <span>当前状态</span>
          <strong>{{ diagnostics ? '已加载诊断结果' : '等待诊断结果' }}</strong>
        </article>
        <article class="manifest-intro-card">
          <span>漂移关注</span>
          <strong>{{ diagnostics ? `${diagnostics.summary.driftCount} 项` : '待加载' }}</strong>
        </article>
      </div>
    </section>

    <div v-if="diagnostics" class="content-grid">
      <section class="diagnostic-section">
        <div class="card-header">总览</div>
        <div class="summary-grid">
          <div class="summary-item" v-for="item in summaryItems" :key="item.label">
            <span class="label">{{ item.label }}</span>
            <strong class="value">{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="diagnostic-section">
        <div class="card-header">漂移详情</div>

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
      </section>

      <section class="diagnostic-section">
        <div class="card-header">输出协议健康度</div>

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
      </section>

      <section class="diagnostic-section">
        <div class="card-header">Alias 漂移</div>

        <el-table :data="aliasRows" size="small" empty-text="无 alias 漂移" stripe>
          <el-table-column prop="type" label="来源" width="120" />
          <el-table-column prop="id" label="发现 ID" min-width="220" />
          <el-table-column prop="canonicalId" label="规范 ID" min-width="220" />
          <el-table-column prop="calls" label="调用数" width="100" />
        </el-table>
      </section>

      <section class="diagnostic-section">
        <div class="card-header">样本数据</div>
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
      </section>
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
import AdminPageHeader from './components/AdminPageHeader.vue';
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
const manifestHighlights = computed(() => [
  { label: diagnostics.value ? `漂移 ${diagnostics.value.summary.driftCount}` : '等待诊断结果', tone: diagnostics.value?.summary.driftCount ? 'warning' as const : 'info' as const },
  { label: diagnostics.value ? `Manifest ${diagnostics.value.summary.manifestTotal}` : 'Manifest 待加载', tone: 'neutral' as const },
  { label: diagnostics.value ? `注册表 ${diagnostics.value.summary.registrationTotal}` : '注册表待加载', tone: 'neutral' as const },
  { label: diagnostics.value ? `日志样本 ${diagnostics.value.summary.outputContractSampleSize ?? 0}` : '日志样本待加载', tone: 'success' as const }
]);

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
  position: relative;
}

.manifest-intro {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
  gap: 14px;
  padding-bottom: 16px;
  border-bottom: var(--admin-border-subtle);
}

.manifest-intro__copy {
  display: grid;
  gap: 6px;
}

.manifest-intro__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.manifest-intro__copy h3 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: 1.04rem;
}

.manifest-intro__copy p {
  margin: 0;
  color: var(--admin-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.manifest-intro__stats {
  display: grid;
  gap: 0;
  padding: 4px;
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  background: var(--admin-bg-surface-alt);
}

.manifest-intro-card {
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.manifest-intro-card + .manifest-intro-card {
  border-top: var(--admin-border-subtle);
}

.manifest-intro-card span {
  color: var(--admin-text-muted);
  font-size: 11px;
}

.manifest-intro-card strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 20px 24px;
  position: relative;
  z-index: 1;
}

.diagnostic-section {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding-top: 16px;
  border-top: var(--admin-border-subtle);
}

.card-header {
  font-weight: 700;
  color: var(--admin-text-primary);
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
  border: 1px solid var(--admin-border-color);
  border-left: 3px solid var(--admin-color-info);
  border-radius: var(--admin-radius-sm);
  padding: 0.65rem 0.8rem;
  transition: border-color 0.2s;
}

.summary-item:hover {
  border-left-color: rgba(52, 120, 246, 0.5);
}

.summary-item .label {
  color: var(--admin-text-secondary);
  font-size: 0.88rem;
}

.summary-item .value {
  color: var(--admin-text-primary);
  font-size: 1rem;
}

.drift-list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.drift-item {
  border: 1px solid var(--admin-border-color);
  border-radius: var(--admin-radius-sm);
  padding: 0.75rem;
}

.drift-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.45rem;
}

.drift-label {
  color: var(--admin-text-primary);
  font-weight: 500;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.more {
  color: var(--admin-text-secondary);
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
  border: 1px dashed var(--admin-border-color);
  border-radius: var(--admin-radius-sm);
  padding: 0.7rem;
}

.sample-title {
  color: var(--admin-text-secondary);
  margin-bottom: 0.55rem;
  font-size: 0.88rem;
}

/* Table deep overrides */
.diagnostic-section :deep(.el-table) {
  border-radius: 12px;
  overflow: hidden;
}

.diagnostic-section :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.04);
  font-weight: 600;
  font-size: 0.8125rem;
}

.diagnostic-section :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(141, 107, 255, 0.02);
}

@media (max-width: 768px) {
  .manifest-intro {
    grid-template-columns: 1fr;
  }

  .content-grid {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}

</style>
