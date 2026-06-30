<!--
  PromptAIDraftPane
  ============================================================
  调用 adminSkillAuthorApi.draft 让大模型起草 prompt。
  输入信号：
    - 角色描述 displayName + description
    - 必产出字段（运营手填，valueType 选）
    - 可选样例输入
  起草后可以一键编译验收（用 adminSkillAuthorApi.compile）。
  最终通过「→ 送入编辑器」回传给上层。
-->
<template>
  <div class="ai-draft-pane">
    <!-- intro -->
    <el-alert type="info" :closable="false" show-icon class="ai-intro">
      <template #title>AI 起草 prompt</template>
      <div style="font-size: 12.5px; line-height: 1.7">
        告诉 AI：这个 agent / skill 是干什么的、要产出哪些字段。
        AI 会按平台元规则生成一份起草版 system prompt。
        你可以再做一次「编译验收」（让另一个 LLM 跑一次空载 + 字段命中检测）。
      </div>
    </el-alert>

    <!-- 输入表单 -->
    <section class="ai-form">
      <el-form label-position="top" size="small">
        <div class="ai-form__row">
          <el-form-item label="Skill / Agent 名称" required>
            <el-input v-model="form.displayName" :placeholder="agent.displayName || agent.agentId" />
          </el-form-item>
          <el-form-item label="Skill / Agent ID">
            <el-input :model-value="agent.agentId" disabled />
          </el-form-item>
        </div>

        <el-form-item label="角色描述" required>
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="例：这是一个目标对话 agent，负责理解用户的真实学习目标，并在合适的时候提议总结。需要保持温柔但不啰嗦的语气。"
          />
        </el-form-item>

        <el-form-item label="必产出字段（至少 1 个）" required>
          <!-- A. 字段路由可选区（如果该 agent 有 stage 映射）-->
          <div v-if="stageFields.length > 0" class="field-picker">
            <div class="field-picker__head">
              <div class="field-picker__title">
                <span class="picker-pill">{{ stageLabel }} 阶段字段路由</span>
                <span class="picker-hint">勾选你希望该 prompt 必须输出的字段</span>
              </div>
              <div class="field-picker__actions">
                <el-button size="small" link @click="pickRecommended">勾选推荐</el-button>
                <el-button size="small" link @click="pickAllSelectable">全选</el-button>
                <el-button size="small" link @click="pickClear">清空</el-button>
              </div>
            </div>
            <div class="field-picker__filters">
              <el-input
                v-model="fieldKeyword"
                size="small"
                placeholder="搜字段 ID / 描述"
                clearable
                style="width: 220px"
              />
              <el-checkbox-group v-model="roleFilter" class="role-checkbox-group" size="small">
                <el-checkbox-button
                  v-for="role in promptRoleOptions"
                  :key="role.value"
                  :label="role.value"
                >{{ role.label }}</el-checkbox-button>
              </el-checkbox-group>
            </div>
            <div class="field-picker__list">
              <label
                v-for="f in filteredStageFields"
                :key="f.fieldId"
                class="field-card"
                :class="{
                  'field-card--checked': selectedFieldIds.has(f.fieldId),
                  'field-card--locked': f.systemLocked
                }"
              >
                <input
                  type="checkbox"
                  :checked="selectedFieldIds.has(f.fieldId)"
                  :disabled="f.systemLocked"
                  @change="toggleField(f.fieldId)"
                />
                <div class="field-card__main">
                  <div class="field-card__head">
                    <code class="field-card__id">{{ f.fieldId }}</code>
                    <span :class="['field-card__role', `role-${f.promptRole}`]">
                      {{ rolePillLabel(f.promptRole) }}
                    </span>
                    <span class="field-card__type">{{ f.valueType }}</span>
                    <span v-if="f.systemLocked" class="field-card__lock">🔒 system</span>
                  </div>
                  <div v-if="f.description" class="field-card__desc">{{ f.description }}</div>
                </div>
              </label>
            </div>
            <div class="field-picker__summary">
              已选 <strong>{{ selectedFieldIds.size }}</strong> / {{ stageFields.length }} 字段
            </div>
          </div>

          <!-- B. 手填区（始终可用）-->
          <details class="manual-fields" :open="stageFields.length === 0">
            <summary>
              {{ stageFields.length > 0 ? '+ 添加未在表里的字段' : '手动输入字段' }}
              <span v-if="stageFields.length === 0" class="manual-hint">
                · 该 agent 还未迁移到字段路由，需要手动填写
              </span>
            </summary>
            <div class="fields-list">
              <div
                v-for="(field, idx) in form.manualFields"
                :key="idx"
                class="field-row"
              >
                <el-input
                  v-model="field.fieldId"
                  size="small"
                  placeholder="fieldId（如 internal.core.stage）"
                  style="flex: 2"
                />
                <el-select v-model="field.valueType" size="small" style="width: 120px">
                  <el-option label="string" value="string" />
                  <el-option label="number" value="number" />
                  <el-option label="boolean" value="boolean" />
                  <el-option label="enum" value="enum" />
                  <el-option label="object" value="object" />
                  <el-option label="array" value="array" />
                </el-select>
                <el-input
                  v-model="field.description"
                  size="small"
                  placeholder="字段说明（可选）"
                  style="flex: 3"
                />
                <el-button
                  size="small"
                  link
                  type="danger"
                  @click="removeField(idx)"
                >×</el-button>
              </div>
              <el-button size="small" @click="addField">+ 加字段</el-button>
            </div>
          </details>
        </el-form-item>

        <details class="advanced">
          <summary>高级（可选）</summary>
          <el-form-item label="作者备注">
            <el-input
              v-model="form.authorNote"
              type="textarea"
              :rows="2"
              placeholder="给 AI 的特殊提示，例如「请用 JSON 输出且 stage 字段使用枚举值」"
            />
          </el-form-item>
        </details>

        <div class="ai-form__actions">
          <el-button
            type="primary"
            :icon="Magic"
            :loading="drafting"
            @click="onDraft"
          >让 AI 起草</el-button>
        </div>
      </el-form>
    </section>

    <!-- 起草结果 -->
    <section v-if="draftResult" class="ai-result">
      <header class="ai-result__head">
        <h4>起草结果</h4>
        <span class="ai-result__meta">
          {{ draftResult.modelUsed }} ·
          {{ draftResult.durationMs }}ms ·
          元规则 {{ draftResult.metaRulesVersion }}
        </span>
      </header>
      <pre class="ai-result__body">{{ draftResult.systemPrompt }}</pre>
      <div v-if="draftResult.outputSchemaSummary" class="ai-result__schema">
        <strong>AI 自陈输出结构：</strong>
        <pre>{{ draftResult.outputSchemaSummary }}</pre>
      </div>
      <div class="ai-result__actions">
        <el-button size="small" @click="onCompile" :loading="compiling">
          编译验收（空载试跑 + 字段命中）
        </el-button>
        <el-button size="small" type="primary" @click="onSendToEditor">
          → 送入编辑器
        </el-button>
      </div>
    </section>

    <!-- 编译结果 -->
    <section v-if="compileResult" class="compile-result">
      <header
        :class="[
          'compile-result__head',
          compileResult.pass ? 'compile-result__head--pass' : 'compile-result__head--fail'
        ]"
      >
        <h4>{{ compileResult.pass ? '✓ 编译通过' : '✗ 编译失败' }}</h4>
        <span>{{ compileResult.durationMs }}ms · {{ compileResult.modelUsed }}</span>
      </header>
      <div v-if="compileResult.missingFields?.length" class="compile-result__missing">
        <strong>缺失字段：</strong>
        <span
          v-for="m in compileResult.missingFields"
          :key="m"
          class="missing-tag"
        >{{ m }}</span>
      </div>
      <details v-if="compileResult.fieldHits" class="compile-result__hits">
        <summary>字段命中详情</summary>
        <ul>
          <li v-for="(hit, key) in compileResult.fieldHits" :key="key">
            <code>{{ key }}</code>
            <span :class="hit ? 'hit-y' : 'hit-n'">{{ hit ? '✓' : '×' }}</span>
          </li>
        </ul>
      </details>
      <div v-if="compileResult.suggestions?.length" class="compile-result__suggestions">
        <strong>AI 建议：</strong>
        <ul>
          <li v-for="(s, i) in compileResult.suggestions" :key="i">{{ s }}</li>
        </ul>
      </div>
      <details class="compile-result__raw">
        <summary>原始输出</summary>
        <pre>{{ compileResult.rawOutput }}</pre>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { MagicStick as Magic } from '@element-plus/icons-vue';
import { adminSkillAuthorApi, adminPromptOpsApi } from '@/api/adminApi';
import { toast } from '../../../../utils/toast';

interface Props {
  agent: any;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'draft-ready', systemPrompt: string): void;
}>();

interface StageField {
  fieldId: string;
  stage: string;
  promptRole: string;
  valueType: string;
  description: string | null;
  systemLocked: boolean;
  structureLocked: boolean;
  recommendedSelected: boolean;
}

const form = ref({
  displayName: '',
  description: '',
  manualFields: [] as Array<{ fieldId: string; valueType: string; description: string }>,
  authorNote: '',
});

const stageFields = ref<StageField[]>([]);
const stageLabel = ref<string>('');
const selectedFieldIds = ref<Set<string>>(new Set());
const fieldKeyword = ref('');
const roleFilter = ref<string[]>([]);

const promptRoleOptions = [
  { value: 'hard-required', label: '必填' },
  { value: 'soft-info', label: '软信息' },
  { value: 'hidden-inference', label: '隐式推断' },
  { value: 'public-reply', label: '公开回复' },
  { value: 'proposal-output', label: '提议输出' },
  { value: 'derived-presentation', label: '衍生展示' },
  { value: 'control-signal', label: '控制信号' },
];

function rolePillLabel(role: string): string {
  return promptRoleOptions.find((o) => o.value === role)?.label || role;
}

const filteredStageFields = computed(() => {
  const kw = fieldKeyword.value.trim().toLowerCase();
  return stageFields.value.filter((f) => {
    if (roleFilter.value.length > 0 && !roleFilter.value.includes(f.promptRole)) {
      return false;
    }
    if (!kw) return true;
    return (
      f.fieldId.toLowerCase().includes(kw) ||
      (f.description || '').toLowerCase().includes(kw)
    );
  });
});

function toggleField(fieldId: string) {
  const next = new Set(selectedFieldIds.value);
  if (next.has(fieldId)) next.delete(fieldId);
  else next.add(fieldId);
  selectedFieldIds.value = next;
}

function pickRecommended() {
  const next = new Set<string>();
  for (const f of stageFields.value) {
    if (f.recommendedSelected) next.add(f.fieldId);
  }
  selectedFieldIds.value = next;
}

function pickAllSelectable() {
  const next = new Set<string>();
  for (const f of stageFields.value) {
    if (!f.systemLocked) next.add(f.fieldId);
  }
  selectedFieldIds.value = next;
}

function pickClear() {
  selectedFieldIds.value = new Set();
}

const drafting = ref(false);
const compiling = ref(false);
const draftResult = ref<{
  systemPrompt: string;
  outputSchemaSummary?: string;
  durationMs: number;
  modelUsed: string;
  metaRulesVersion: string;
} | null>(null);

const compileResult = ref<{
  pass: boolean;
  missingFields?: string[];
  fieldHits?: Record<string, boolean>;
  suggestions?: string[];
  rawOutput?: string;
  durationMs: number;
  modelUsed: string;
} | null>(null);

function addField() {
  form.value.manualFields.push({
    fieldId: '',
    valueType: 'string',
    description: '',
  });
}

function removeField(idx: number) {
  form.value.manualFields.splice(idx, 1);
}

function collectAllFields() {
  // 合并：选中的 stageField + 手填 manualField
  const result: Array<{
    fieldId: string;
    valueType: string;
    description?: string;
  }> = [];
  for (const f of stageFields.value) {
    if (selectedFieldIds.value.has(f.fieldId)) {
      result.push({
        fieldId: f.fieldId,
        valueType: f.valueType || 'string',
        description: f.description || undefined,
      });
    }
  }
  for (const m of form.value.manualFields) {
    if (m.fieldId.trim()) {
      result.push({
        fieldId: m.fieldId.trim(),
        valueType: m.valueType || 'string',
        description: m.description || undefined,
      });
    }
  }
  return result;
}

async function loadStageFields() {
  if (!props.agent?.agentId) return;
  try {
    const r = await adminPromptOpsApi.getAgentFields(props.agent.agentId);
    const data = r.data?.data;
    stageFields.value = data?.fields || [];
    stageLabel.value = data?.stage
      ? data.stage === 'goal'
        ? '目标'
        : data.stage === 'path'
          ? '路径'
          : '学习'
      : '';
    // 默认勾推荐
    pickRecommended();
  } catch {
    stageFields.value = [];
    stageLabel.value = '';
  }
}

async function onDraft() {
  const fields = collectAllFields();
  if (!form.value.displayName.trim()) {
    toast.error('请填名称');
    return;
  }
  if (!form.value.description.trim()) {
    toast.error('请填角色描述');
    return;
  }
  if (fields.length === 0) {
    toast.error('至少需要 1 个必产出字段（勾选已有字段或手填）');
    return;
  }
  drafting.value = true;
  draftResult.value = null;
  compileResult.value = null;
  try {
    const r = await adminSkillAuthorApi.draft({
      skillId: props.agent.agentId,
      displayName: form.value.displayName,
      description: form.value.description,
      requiredFields: fields.map((f) => ({
        fieldId: f.fieldId,
        valueType: f.valueType as any,
        description: f.description,
      })),
      authorNote: form.value.authorNote || undefined,
    });
    draftResult.value = r.data?.data || null;
    if (draftResult.value) {
      toast.success('AI 起草完成');
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || 'AI 起草失败');
  } finally {
    drafting.value = false;
  }
}

async function onCompile() {
  if (!draftResult.value) return;
  const fieldIds = collectAllFields().map((f) => f.fieldId);
  compiling.value = true;
  compileResult.value = null;
  try {
    const r = await adminSkillAuthorApi.compile({
      systemPrompt: draftResult.value.systemPrompt,
      requiredFieldIds: fieldIds,
    });
    compileResult.value = r.data?.data || null;
    if (compileResult.value?.pass) {
      toast.success('编译通过');
    } else {
      toast.error('编译失败：见下方详情');
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '编译失败');
  } finally {
    compiling.value = false;
  }
}

function onSendToEditor() {
  if (!draftResult.value) return;
  emit('draft-ready', draftResult.value.systemPrompt);
}

watch(
  () => props.agent?.agentId,
  () => {
    selectedFieldIds.value = new Set();
    form.value.manualFields = [];
    void loadStageFields();
  }
);

onMounted(() => {
  if (props.agent?.displayName) {
    form.value.displayName = props.agent.displayName;
  }
  if (props.agent?.description) {
    form.value.description = props.agent.description;
  }
  void loadStageFields();
});
</script>

<style scoped>
.ai-draft-pane {
  display: grid;
  gap: 14px;
}

/* ============ Field Picker ============ */
.field-picker {
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.field-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.field-picker__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.picker-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  color: #1e40af;
}

.picker-hint {
  font-size: 11.5px;
  color: #64748b;
}

.field-picker__actions {
  display: flex;
  gap: 4px;
}

.field-picker__filters {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.role-checkbox-group {
  flex: 1;
}

.role-checkbox-group :deep(.el-checkbox-button__inner) {
  font-size: 11px;
  padding: 4px 10px;
}

.field-picker__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding: 2px;
}

.field-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  cursor: pointer;
  transition: all 0.15s ease;
}

.field-card:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.field-card--checked {
  background: rgba(52, 120, 246, 0.06);
  border-color: #3478f6;
}

.field-card--locked {
  opacity: 0.55;
  cursor: not-allowed;
}

.field-card input[type='checkbox'] {
  margin-top: 3px;
  cursor: pointer;
}

.field-card--locked input[type='checkbox'] {
  cursor: not-allowed;
}

.field-card__main {
  flex: 1;
  min-width: 0;
}

.field-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.field-card__id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #1a2a44;
  background: transparent;
  padding: 0;
}

.field-card__role {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}

.role-hard-required { background: rgba(220, 38, 38, 0.12); color: #b91c1c; }
.role-soft-info { background: rgba(52, 120, 246, 0.12); color: #1e40af; }
.role-hidden-inference { background: rgba(139, 92, 246, 0.12); color: #6d28d9; }
.role-public-reply { background: rgba(22, 163, 74, 0.12); color: #15803d; }
.role-proposal-output { background: rgba(245, 158, 11, 0.12); color: #b45309; }
.role-derived-presentation { background: rgba(14, 165, 233, 0.12); color: #0369a1; }
.role-control-signal { background: rgba(100, 116, 139, 0.12); color: #334155; }

.field-card__type {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  color: #94a3b8;
  background: white;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #e2e8f0;
}

.field-card__lock {
  font-size: 10px;
  color: #b45309;
}

.field-card__desc {
  margin-top: 4px;
  font-size: 11px;
  color: #62758f;
  line-height: 1.5;
}

.field-picker__summary {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
  font-size: 11.5px;
  color: #475569;
}

.field-picker__summary strong {
  color: #3478f6;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  margin: 0 2px;
}

/* manual-fields fold-out */
.manual-fields {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
}

.manual-fields summary {
  cursor: pointer;
  font-size: 12px;
  color: #475569;
  font-weight: 600;
  margin-bottom: 8px;
}

.manual-hint {
  font-size: 11px;
  color: #b45309;
  font-weight: 400;
}

.ai-intro :deep(.el-alert__content) {
  flex: 1;
}

.ai-form {
  background: #f8fafc;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.ai-form__row {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 12px;
}

.ai-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.fields-list {
  display: grid;
  gap: 6px;
}

.field-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.advanced {
  margin: 6px 0;
  padding: 8px 12px;
  background: white;
  border-radius: 8px;
}

.advanced summary {
  cursor: pointer;
  font-size: 12px;
  color: #475569;
  font-weight: 600;
}

.ai-form__actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.ai-result {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.04), white);
  border: 1px solid rgba(141, 107, 255, 0.2);
  border-radius: 12px;
  padding: 16px 18px;
}

.ai-result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ai-result__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #6d28d9;
}

.ai-result__meta {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #94a3b8;
}

.ai-result__body {
  margin: 0;
  padding: 12px 14px;
  background: white;
  border: 1px solid #e9d5ff;
  border-radius: 8px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #334155;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-result__schema {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(141, 107, 255, 0.05);
  border-radius: 6px;
  font-size: 11.5px;
}

.ai-result__schema pre {
  margin: 4px 0 0;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #475569;
}

.ai-result__actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.compile-result {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
}

.compile-result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 10px;
}

.compile-result__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}

.compile-result__head--pass {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
}

.compile-result__head--fail {
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
}

.compile-result__head span {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: inherit;
  opacity: 0.7;
}

.compile-result__missing {
  margin-bottom: 8px;
  font-size: 12.5px;
}

.missing-tag {
  display: inline-block;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
  padding: 2px 6px;
  border-radius: 4px;
  margin: 2px 4px 2px 0;
}

.compile-result__hits ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
  font-size: 11.5px;
}

.compile-result__hits li {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f8fafc;
  border-radius: 4px;
}

.compile-result__hits code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #334155;
}

.hit-y {
  color: #15803d;
  font-weight: 700;
}

.hit-n {
  color: #b91c1c;
  font-weight: 700;
}

.compile-result__suggestions {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(245, 158, 11, 0.06);
  border-radius: 6px;
  font-size: 12px;
}

.compile-result__suggestions ul {
  margin: 4px 0 0;
  padding-left: 20px;
  color: #b45309;
}

.compile-result__raw {
  margin-top: 8px;
}

.compile-result__raw summary {
  cursor: pointer;
  font-size: 11.5px;
  color: #94a3b8;
}

.compile-result__raw pre {
  margin: 4px 0 0;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  background: #f8fafc;
  padding: 8px 10px;
  border-radius: 6px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
