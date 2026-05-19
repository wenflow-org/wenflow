<template>
  <div class="skill-model-config">
    <div class="bg-layer">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">
        <el-icon><Operation /></el-icon>
        Skill 模型配置
      </span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Operation /></el-icon>
        Skill 模型配置
      </h2>
      <p class="page-hero__subtitle">配置 Skill 使用的模型、思考模式、思考强度与超时</p>
    </div>

    <div class="summary-grid" v-show="summary" style="position: relative; z-index: 1;">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">Skill 总数</div>
        <div class="value">{{ summary?.total }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">正常工作</div>
        <div class="value">{{ summary?.working }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">简化实现</div>
        <div class="value">{{ summary?.simplified }}</div>
      </el-card>
      <el-card class="summary-card summary-card--red" shadow="hover">
        <div class="label">需关注</div>
        <div class="value danger">{{ summary?.needsAttention }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索 Skill ID / 名称" clearable class="search" />
        <el-select v-model="statusFilter" placeholder="工作状态" clearable class="select">
          <el-option label="正常" value="working" />
          <el-option label="占位" value="placeholder" />
          <el-option label="简化" value="simplified" />
          <el-option label="模拟" value="mock" />
        </el-select>
        <el-checkbox v-model="onlyEnabled">仅看独立配置</el-checkbox>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button class="action-btn action-btn--ghost" @click="refresh">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="table-shell">
      <el-table :data="filteredConfigs" v-loading="loading" stripe>
        <el-table-column label="Skill" min-width="280">
          <template #default="{ row }">
            <div class="skill-cell">
              <strong class="skill-cell__name">{{ row.displayName || row.skillId }}</strong>
              <span class="skill-cell__id" v-if="row.displayName">{{ row.skillId }}</span>
              <span class="skill-cell__meta">{{ row.tier }}</span>
              <span v-if="getSkillHint(row.skillId)" class="skill-cell__hint">{{ getSkillHint(row.skillId) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="140">
          <template #default="{ row }">
            <div class="status-cell">
              <el-tag v-if="row.status" :type="getStatusTagType(row.status)" size="small">
                {{ getStatusLabel(row.status) }}
              </el-tag>
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                {{ row.enabled ? '独立配置' : '继承' }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="配置策略" min-width="240">
          <template #default="{ row }">
            <div class="strategy-cell">
              <span class="strategy-cell__model">{{ row.model || '继承 Agent / 平台默认' }}</span>
              <div class="strategy-cell__tags">
                <el-tag :type="thinkingTagType(row.thinkingMode)">{{ formatThinkingMode(row.thinkingMode) }}</el-tag>
                <el-tag :type="effortTagType(row.reasoningEffort)">{{ formatReasoningEffort(row.reasoningEffort) }}</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="参数摘要" min-width="180">
          <template #default="{ row }">
            <div class="params-cell">
              <div class="params-cell__row">
                <span>T={{ row.temperature ?? '--' }}</span>
                <span>Max {{ row.maxTokens ?? '--' }}</span>
              </div>
              <div class="params-cell__row params-cell__row--sub">
                <el-tag size="small" type="info">{{ formatTimeout(row.requestTimeoutMs) }}</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="editConfig(row)">编辑</el-button>
            <el-button type="warning" link :disabled="!row.enabled" @click="deleteConfig(row)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editDialogVisible" title="编辑 Skill 配置" width="620px" class="skill-config-dialog" destroy-on-close>
      <el-form ref="editFormRef" class="skill-config-form" :model="editForm" :rules="editRules" label-width="110px">
        <el-form-item label="Skill ID">
          <el-input v-model="editForm.skillId" disabled />
        </el-form-item>
        <el-alert
          v-if="getSkillHint(editForm.skillId)"
          :title="getSkillHint(editForm.skillId)"
          type="info"
          :closable="false"
          show-icon
          class="skill-config-form__notice"
        />
        <el-form-item label="中文名称">
          <el-input v-model="editForm.displayName" disabled placeholder="无" />
        </el-form-item>
        <el-form-item label="独立配置">
          <el-switch v-model="editForm.enabled" />
          <div class="field-hint">关闭后将继承当前调用 Agent 的配置；若无 Agent 上下文，则回落平台默认</div>
        </el-form-item>
        <el-form-item label="模型层级">
          <el-select v-model="editForm.tier" placeholder="选择层级" style="width: 100%" :disabled="!editForm.enabled">
            <el-option label="chat" value="chat" />
            <el-option label="reasoning" value="reasoning" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="editForm.model" :disabled="!editForm.enabled" placeholder="留空继承 Agent / 平台默认" />
        </el-form-item>
        <el-form-item label="思考模式">
          <el-select v-model="editForm.thinkingMode" placeholder="选择思考模式" style="width: 100%" :disabled="!editForm.enabled">
            <el-option label="跟随继承值 / 模型默认" value="default" />
            <el-option label="开启" value="enabled" />
            <el-option label="关闭" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="思考强度">
          <el-select v-model="editForm.reasoningEffort" placeholder="选择思考强度" style="width: 100%" :disabled="!editForm.enabled || editForm.thinkingMode === 'disabled'">
            <el-option label="跟随继承值 / 模型默认" value="default" />
            <el-option label="high" value="high" />
            <el-option label="max" value="max" />
          </el-select>
          <div class="field-hint">仅在模型启用思考时生效</div>
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="editForm.temperature" :min="0" :max="1" :step="0.1" show-input :disabled="!editForm.enabled" />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="editForm.maxTokens" :min="100" :max="20000" :disabled="!editForm.enabled" />
        </el-form-item>
        <el-form-item label="请求超时(ms)">
          <el-input-number v-model="editForm.requestTimeoutMs" :min="10000" :max="600000" :step="10000" :disabled="!editForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="skill-config-dialog__footer">
          <el-button class="action-btn action-btn--ghost" @click="editDialogVisible = false">取消</el-button>
          <el-button class="action-btn action-btn--primary" :loading="saving" @click="saveConfig">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { Operation, Refresh } from '@element-plus/icons-vue';
import { adminSkillsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';
import { ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';

interface SkillModelConfig {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  tier: string;
  model?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature?: number;
  maxTokens?: number;
  requestTimeoutMs?: number | null;
  enabled: boolean;
}

const configs = ref<SkillModelConfig[]>([]);
const loading = ref(false);
const keyword = ref('');
const statusFilter = ref('');
const onlyEnabled = ref(false);
const summary = ref<{ total: number; working: number; simplified: number; needsAttention: number } | null>(null);

const editDialogVisible = ref(false);
const saving = ref(false);
const editFormRef = ref<FormInstance>();
const editRules = {
  temperature: [{ required: true, message: '请设置温度', trigger: 'change' }],
  maxTokens: [{ required: true, message: '请输入最大 Token 数', trigger: 'blur' }],
};
const editForm = ref<SkillModelConfig>({
  skillId: '',
  displayName: '',
  tier: 'chat',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  temperature: 0.7,
  maxTokens: 2000,
  requestTimeoutMs: null,
  enabled: false,
});

const filteredConfigs = computed(() => {
  return configs.value.filter(config => {
    const byKeyword = !keyword.value || `${config.skillId} ${config.displayName || ''}`.toLowerCase().includes(keyword.value.toLowerCase());
    const byStatus = !statusFilter.value || config.status === statusFilter.value;
    const byEnabled = !onlyEnabled.value || config.enabled;
    return byKeyword && byStatus && byEnabled;
  });
});

const SKILL_HINTS: Record<string, string> = {
  'path-scene-framing': 'Path 冷启动前处理：先定义认知域、首个交付物和范围边界，再交给 path-agent 主生成。',
  'batch-anderson-labeler': 'Path 任务画像层：为所有任务统一补知识维度、认知层次、学习目标与核心概念标签。',
  'goal-type-identifier': 'Path 任务画像辅助：先判断目标类型与知识分布建议，再喂给任务画像构建器。',
};

const getSkillHint = (skillId?: string) => {
  if (!skillId) return '';
  return SKILL_HINTS[skillId] || '';
};

watch(
  () => editForm.value.thinkingMode,
  (mode) => {
    if (mode === 'disabled') {
      editForm.value.reasoningEffort = 'default';
    }
  }
);

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const res = await adminSkillsApi.getSkillModelConfigs();
    configs.value = res.data?.data || [];
    updateSummary();
  } catch {
    toast.error('获取 Skill 配置失败');
  }
  loading.value = false;
};

const updateSummary = () => {
  const total = configs.value.length;
  const working = configs.value.filter(c => c.status === 'working').length;
  const simplified = configs.value.filter(c => c.status === 'simplified').length;
  const needsAttention = configs.value.filter(c => c.status === 'placeholder' || c.status === 'mock').length;
  summary.value = { total, working, simplified, needsAttention };
};

const formatThinkingMode = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return '开启';
  if (thinkingMode === 'disabled') return '关闭';
  return '继承/默认';
};

const formatReasoningEffort = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return 'high';
  if (reasoningEffort === 'max') return 'max';
  return '继承/默认';
};

const thinkingTagType = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return 'warning';
  if (thinkingMode === 'disabled') return 'success';
  return 'info';
};

const effortTagType = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'max') return 'danger';
  if (reasoningEffort === 'high') return 'warning';
  return 'info';
};

const formatTimeout = (timeoutMs?: number | null) => {
  if (!timeoutMs || Number.isNaN(Number(timeoutMs))) return '继承';
  return `${Math.round(Number(timeoutMs) / 1000)}s`;
};

const getStatusTagType = (status?: 'working' | 'placeholder' | 'simplified' | 'mock') => {
  if (status === 'working') return 'success';
  if (status === 'placeholder') return 'danger';
  if (status === 'simplified') return 'warning';
  if (status === 'mock') return 'info';
  return '';
};

const getStatusLabel = (status?: 'working' | 'placeholder' | 'simplified' | 'mock') => {
  if (status === 'working') return '正常';
  if (status === 'placeholder') return '占位';
  if (status === 'simplified') return '简化';
  if (status === 'mock') return '模拟';
  return '';
};

const toEditablePayload = (config: SkillModelConfig) => ({
  tier: config.tier,
  model: config.model,
  thinkingMode: config.thinkingMode || 'default',
  reasoningEffort: config.thinkingMode === 'disabled' ? 'default' : (config.reasoningEffort || 'default'),
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  requestTimeoutMs: config.enabled ? config.requestTimeoutMs : null,
  enabled: config.enabled,
});

const editConfig = (row: SkillModelConfig) => {
  editForm.value = {
    ...row,
    displayName: row.displayName || '',
    thinkingMode: row.thinkingMode || 'default',
    reasoningEffort: row.reasoningEffort || 'default',
  };
  editDialogVisible.value = true;
};

const saveConfig = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminSkillsApi.updateSkillModelConfig(editForm.value.skillId, toEditablePayload(editForm.value));
    toast.success('Skill 配置已更新');
    editDialogVisible.value = false;
    fetchConfigs();
  } catch {
    toast.error('保存失败');
  } finally {
    saving.value = false;
  }
};

const deleteConfig = async (row: SkillModelConfig) => {
  try {
    await ElMessageBox.confirm(
      `确定要恢复 ${row.displayName || row.skillId} 的默认模型配置吗？此操作不可撤销。`,
      '确认恢复默认',
      {
        confirmButtonText: '确认恢复',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
  } catch {
    return;
  }

  try {
    await adminSkillsApi.deleteSkillModelConfig(row.skillId);
    toast.success('配置已恢复默认');
    fetchConfigs();
  } catch {
    toast.error('删除失败');
  }
};

const refresh = () => fetchConfigs();

onMounted(() => fetchConfigs());
</script>

<style scoped>
.skill-model-config {
  padding: 1.25rem;
}

.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
.summary-card { border-radius: var(--radius-lg); border: 1px solid var(--border-default); background: var(--glass-bg-light); }
.summary-card .label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.summary-card .value { font-size: 1.75rem; font-weight: 800; margin-top: 0.25rem; }
.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--orange .value { color: #ea580c; }
.summary-card--red .value { color: #dc2626; }
.summary-card .danger { color: #dc2626; }

.admin-list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; position: relative; z-index: 1; }
.admin-list-toolbar__group { display: flex; align-items: center; gap: 0.5rem; }
.admin-list-toolbar .search { width: 220px; }
.admin-list-toolbar .select { width: 120px; }

.action-btn {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid transparent;
  font-weight: 700;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: 180ms ease;
}

.action-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, color-mix(in srgb, #3478f6 68%, #8d6bff));
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.24);
}

.action-btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
}

.action-btn--ghost {
  color: var(--text-primary, #1a1a1a);
  border-color: rgba(52, 120, 246, 0.15);
  background: rgba(255, 255, 255, 0.82);
}

.action-btn--ghost:hover {
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(238, 245, 255, 0.92);
  color: var(--color-primary, #3478f6);
}

.table-shell {
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  overflow-x: auto;
  overflow-y: hidden;
  background: color-mix(in srgb, #ffffff 90%, white);
  backdrop-filter: blur(20px);
  position: relative;
  z-index: 1;
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16);
}

:deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

:deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
  font-size: 0.8125rem;
  color: #7085a6;
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.015);
}

:deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

:deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
}

.skill-cell {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.skill-cell__name {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 700;
}

.skill-cell__id {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.skill-cell__meta {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.skill-cell__hint {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.status-cell { display: flex; gap: 0.5rem; align-items: center; }

.strategy-cell {
  display: grid;
  gap: 6px;
}

.strategy-cell__model {
  color: var(--text-primary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strategy-cell__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.params-cell {
  display: grid;
  gap: 6px;
}

.params-cell__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-primary);
  font-size: 12px;
}

.params-cell__row--sub {
  justify-content: flex-start;
}

.skill-config-dialog :deep(.el-dialog) {
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.skill-config-form__notice {
  margin-bottom: 0.25rem;
}

.skill-config-dialog :deep(.el-dialog__header) {
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(247, 250, 255, 0.92));
}

.skill-config-dialog :deep(.el-dialog__title) {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.skill-config-dialog :deep(.el-dialog__body) {
  padding: 18px 22px 12px;
  background: rgba(255, 255, 255, 0.95);
}

.skill-config-dialog :deep(.el-dialog__footer) {
  padding: 12px 22px 18px;
  border-top: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(251, 253, 255, 0.95), rgba(245, 248, 253, 0.95));
}

.skill-config-form {
  display: grid;
  gap: 4px;
}

.skill-config-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.skill-config-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--text-secondary);
}

.skill-config-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .skill-model-config {
    padding: 1rem;
  }
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .admin-list-toolbar { flex-direction: column; align-items: stretch; }
  .admin-list-toolbar__group { justify-content: space-between; }
}
</style>
