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
      <h2 class="page-hero__title">Skill 模型配置</h2>
      <p class="page-hero__subtitle">配置 Skill 使用的模型、思考模式、思考强度与超时</p>
    </div>

    <div class="action-bar">
      <el-button @click="refresh">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-shell">
      <el-table :data="configs" v-loading="loading" stripe>
        <el-table-column prop="skillId" label="Skill ID" min-width="180" />
        <el-table-column prop="enabled" label="独立配置" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已启用' : '继承' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="tier" label="模型层级" width="100" />
        <el-table-column prop="model" label="模型" min-width="150">
          <template #default="{ row }">
            {{ row.model || '继承 Agent / 平台默认' }}
          </template>
        </el-table-column>
        <el-table-column prop="thinkingMode" label="思考模式" width="120">
          <template #default="{ row }">
            <el-tag :type="thinkingTagType(row.thinkingMode)">{{ formatThinkingMode(row.thinkingMode) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reasoningEffort" label="思考强度" width="120">
          <template #default="{ row }">
            <el-tag :type="effortTagType(row.reasoningEffort)">{{ formatReasoningEffort(row.reasoningEffort) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="requestTimeoutMs" label="请求超时" width="120">
          <template #default="{ row }">
            {{ formatTimeout(row.requestTimeoutMs) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" @click="editConfig(row)">编辑</el-button>
            <el-button size="small" type="danger" :disabled="!row.enabled" @click="deleteConfig(row)">重置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editDialogVisible" title="编辑 Skill 配置" width="620px" destroy-on-close>
      <el-form ref="editFormRef" :model="editForm" :rules="editRules">
        <el-form-item label="Skill ID">
          <el-input v-model="editForm.skillId" disabled />
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
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { Operation, Refresh } from '@element-plus/icons-vue';
import { adminSkillsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';
import { ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';

interface SkillModelConfig {
  skillId: string;
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
const editDialogVisible = ref(false);
const saving = ref(false);
const editFormRef = ref<FormInstance>();
const editRules = {
  temperature: [{ required: true, message: '请设置温度', trigger: 'change' }],
  maxTokens: [{ required: true, message: '请输入最大 Token 数', trigger: 'blur' }],
};
const editForm = ref<SkillModelConfig>({
  skillId: '',
  tier: 'chat',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  temperature: 0.7,
  maxTokens: 2000,
  requestTimeoutMs: null,
  enabled: false,
});

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
  } catch {
    toast.error('获取 Skill 配置失败');
  }
  loading.value = false;
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
      `确定要重置 ${row.skillId} 的模型配置吗？此操作不可撤销。`,
      '确认重置',
      {
        confirmButtonText: '确认重置',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
  } catch {
    return;
  }

  try {
    await adminSkillsApi.deleteSkillModelConfig(row.skillId);
    toast.success('配置已重置');
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

.action-bar {
  margin-bottom: 1rem;
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}

.table-shell {
  border: 1px solid var(--border-light);
  border-radius: 20px;
  overflow-x: auto;
  overflow-y: hidden;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px);
  position: relative;
  z-index: 1;
}

:deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

:deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.02);
}

:deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
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
}
</style>
