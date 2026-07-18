<!--
  SkillRuntimeConfigPane
  ============================================================
  Skill 节点级模型运行时参数（skill_model_configs 表）。
  与 Prompt 内 temperature/maxTokens 是两套字段：
    - Prompt 版本里的 T/MaxTokens 跟着 prompt 版本走（agent_prompts 表）
    - 此处的 T/MaxTokens 是节点级覆盖（skill_model_configs 表）
  仅在 agent.kind === 'skill' 时使用。
-->
<template>
  <div class="skill-runtime-pane" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="skill-runtime-pane__notice"
    >
      <template #title>运行参数</template>
      <div style="font-size: 12.5px; line-height: 1.7">
        独立配置会覆盖上层默认值；关闭后恢复继承。
      </div>
    </el-alert>

    <el-empty v-if="!currentSkill && !loading" description="未找到 Skill 节点配置" />

    <template v-if="currentSkill">
      <div class="chip-section">
        <div class="chip-row">
          <span class="chip-label">当前生效</span>
          <el-tag size="small" :type="currentSkill.enabled ? 'success' : 'info'">
            {{ currentSkill.enabled ? '独立配置' : '继承上层 / 平台默认' }}
          </el-tag>
          <el-tag size="small" effect="plain">T={{ currentSkill.temperature ?? '--' }}</el-tag>
          <el-tag size="small" effect="plain">Max={{ currentSkill.maxTokens ?? '--' }}</el-tag>
          <el-tag size="small" effect="plain">{{ formatTimeout(currentSkill.requestTimeoutMs) }}</el-tag>
          <el-tag size="small" effect="plain" :type="thinkingTagType(currentSkill.thinkingMode)">{{ formatThinkingMode(currentSkill.thinkingMode) }}</el-tag>
          <el-tag size="small" effect="plain" :type="effortTagType(currentSkill.reasoningEffort)">{{ formatReasoningEffort(currentSkill.reasoningEffort) }}</el-tag>
        </div>
      </div>

      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="120px" class="skill-runtime-form">
        <el-form-item label="Skill ID">
          <el-input v-model="editForm.skillId" disabled />
        </el-form-item>
        <el-form-item label="中文名称">
          <el-input v-model="editForm.displayName" disabled placeholder="无" />
        </el-form-item>
        <el-form-item label="独立配置">
          <el-switch v-model="editForm.enabled" />
          <div class="field-hint">关闭后继承调用 Agent 或平台默认</div>
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
          <el-select
            v-model="editForm.reasoningEffort"
            placeholder="选择思考强度"
            style="width: 100%"
            :disabled="!editForm.enabled || editForm.thinkingMode === 'disabled'"
          >
            <el-option label="跟随继承值 / 模型默认" value="default" />
            <el-option label="high" value="high" />
            <el-option label="max" value="max" />
          </el-select>
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

      <div class="skill-runtime-pane__footer">
        <el-button type="warning" :disabled="!currentSkill.enabled" @click="onDelete">恢复默认</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
        <el-button @click="loadSkill">刷新</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FormInstance } from 'element-plus';
import { ElMessageBox } from 'element-plus';
import { adminSkillsApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';

interface SkillNodeConfig {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  tier: 'chat' | 'reasoning';
  model?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature?: number;
  maxTokens?: number;
  requestTimeoutMs?: number | null;
  enabled: boolean;
}

const props = defineProps<{
  agentId: string;
}>();

const emit = defineEmits<{ (e: 'changed'): void }>();

const loading = ref(false);
const saving = ref(false);
const currentSkill = ref<SkillNodeConfig | null>(null);
const editFormRef = ref<FormInstance>();
const editForm = ref<SkillNodeConfig>({
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
const editRules = {
  temperature: [{ required: true, message: '请设置温度', trigger: 'change' }],
  maxTokens: [{ required: true, message: '请输入最大 Token 数', trigger: 'blur' }],
};

const SKILL_CN_NAMES: Record<string, string> = {
  'text-structure-analyzer': '文本结构分析器',
  'retrieval': '内容检索器',
  'web-extractor': '网页内容提取器',
  'image-analyzer': '图片分析器',
  'memory-search': '学习记忆搜索器',
  'smart-search': '智能搜索器',
  'label-generator': '动态标签生成器',
  'path-scene-framing': '路径场景构图',
  'stage-designer': '阶段任务设计器',
  'adaptive-guidance-copy': '动态引导文案生成器',
  'goal-profile-inference': '目标阶段画像推断器',
  'learning-pattern-distiller': '学习模式蒸馏器',
  'session-knowledge-distiller': '课堂知识蒸馏器',
  'dialogue-concept-extractor': '对话概念抽取器',
  'virtual-learner-persona-designer': '虚拟学习者身份设计器',
  'virtual-learner-scenario-designer': '虚拟学习者故事设计器',
  'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 对话模拟器',
  'virtual-learner-path-evaluator': '虚拟学习者路径评估器（辅助调试）',
  'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 回合模拟器',
  'virtual-learner-referee': '虚拟学习者实验裁判',
  'peer-reinforcement': '同伴强化',
};

const normalizedSkillId = (raw: string) => raw.startsWith('skill:') ? raw.slice(6) : raw;

const formatThinkingMode = (mode?: string) =>
  mode === 'enabled' ? '开启' : mode === 'disabled' ? '关闭' : '继承/默认';
const formatReasoningEffort = (effort?: string) =>
  effort === 'high' ? 'high' : effort === 'max' ? 'max' : '继承/默认';
const thinkingTagType = (mode?: string): 'warning' | 'success' | 'info' =>
  mode === 'enabled' ? 'warning' : mode === 'disabled' ? 'success' : 'info';
const effortTagType = (effort?: string): 'danger' | 'warning' | 'info' =>
  effort === 'max' ? 'danger' : effort === 'high' ? 'warning' : 'info';
const formatTimeout = (timeoutMs?: number | null) =>
  !timeoutMs || Number.isNaN(Number(timeoutMs)) ? '继承' : `${Math.round(Number(timeoutMs) / 1000)}s`;

const buildFallbackSkillConfig = (skillId: string): SkillNodeConfig => ({
  skillId,
  displayName: SKILL_CN_NAMES[skillId] || skillId,
  tier: 'chat',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  temperature: 0.7,
  maxTokens: 2000,
  requestTimeoutMs: null,
  enabled: false,
});

const toEditablePayload = (config: SkillNodeConfig) => ({
  tier: config.tier,
  model: config.model,
  thinkingMode: config.thinkingMode || 'default',
  reasoningEffort: config.thinkingMode === 'disabled' ? 'default' : (config.reasoningEffort || 'default'),
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  requestTimeoutMs: config.enabled ? config.requestTimeoutMs : null,
  enabled: config.enabled,
});

const skillIdOnly = () => normalizedSkillId(props.agentId);

const applySkill = (skill: SkillNodeConfig) => {
  currentSkill.value = skill;
  editForm.value = {
    ...skill,
    displayName: skill.displayName || SKILL_CN_NAMES[skill.skillId] || skill.skillId,
    thinkingMode: skill.thinkingMode || 'default',
    reasoningEffort: skill.reasoningEffort || 'default',
  };
};

const loadSkill = async () => {
  const skillId = skillIdOnly();
  if (!skillId) return;
  loading.value = true;
  try {
    // 单点查询，避免全量拉取再 find；无独立配置时后端返回 404，按继承默认展示
    const res = await adminSkillsApi.getSkillModelConfig(skillId);
    const skill = (res.data?.data || null) as SkillNodeConfig | null;
    applySkill(skill ?? buildFallbackSkillConfig(skillId));
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      applySkill(buildFallbackSkillConfig(skillId));
    } else {
      toast.error('加载 Skill 节点配置失败');
    }
  } finally {
    loading.value = false;
  }
};

const onSave = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminSkillsApi.updateSkillModelConfig(editForm.value.skillId, toEditablePayload(editForm.value));
    toast.success('Skill 配置已更新');
    emit('changed');
    await loadSkill();
  } catch {
    toast.error('保存 Skill 配置失败');
  } finally {
    saving.value = false;
  }
};

const onDelete = async () => {
  if (!currentSkill.value) return;
  try {
    await ElMessageBox.confirm(
      `确定要恢复 ${currentSkill.value.displayName || currentSkill.value.skillId} 的默认模型配置吗？此操作不可撤销。`,
      '确认恢复默认',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'warning' }
    );
  } catch {
    return;
  }
  try {
    await adminSkillsApi.deleteSkillModelConfig(currentSkill.value.skillId);
    toast.success('配置已恢复默认');
    emit('changed');
    await loadSkill();
  } catch {
    toast.error('恢复 Skill 默认配置失败');
  }
};

watch(() => props.agentId, (next) => { if (next) void loadSkill(); }, { immediate: true });
watch(() => editForm.value.thinkingMode, (mode) => {
  if (mode === 'disabled') editForm.value.reasoningEffort = 'default';
});
</script>

<style scoped>
.skill-runtime-pane {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 4px 0;
  min-width: 0;
}

.skill-runtime-pane__notice :deep(.el-alert__content) {
  flex: 1;
}

.skill-runtime-pane__notice code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.92em;
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
  padding: 1px 5px;
  border-radius: 3px;
}

.chip-section {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.7);
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chip-label {
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  font-weight: 600;
}

.skill-runtime-form {
  background: var(--admin-bg-surface);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 20px 4px;
}

.field-hint {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}

.skill-runtime-pane__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
