<template>
  <div class="skill-model-config">
    <div class="bg-layer">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Skill 模型配置</span>
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
        <el-button @click="refresh">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="admin-list-card">
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
            <el-button type="primary" link @click="openSkillWorkbench(row)">查看设计</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="skillWorkbenchVisible" :title="`Skill 设计详情 · ${currentSkill?.skillId || ''}`" size="min(68%, 980px)" destroy-on-close>
      <div class="skill-workbench" v-loading="skillWorkbenchLoading">
        <template v-if="currentSkill">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="名称">{{ currentSkill.displayName || currentSkill.skillId }}</el-descriptions-item>
            <el-descriptions-item label="Skill ID">{{ currentSkill.skillId }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag v-if="currentSkill.status" :type="getStatusTagType(currentSkill.status)" size="small">
                {{ getStatusLabel(currentSkill.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="配置模式">
              <el-tag :type="currentSkill.enabled ? 'success' : 'info'" size="small">
                {{ currentSkill.enabled ? '独立配置' : '继承' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="模型层级">{{ currentSkill.tier || '-' }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ currentSkill.model || '平台默认' }}</el-descriptions-item>
            <el-descriptions-item label="说明" :span="2">{{ getSkillHint(currentSkill.skillId) || '-' }}</el-descriptions-item>
          </el-descriptions>

          <div class="chip-section">
            <div class="chip-row">
              <span class="chip-label">thinking</span>
              <el-tag size="small" effect="plain" :type="thinkingTagType(currentSkill.thinkingMode)">
                {{ formatThinkingMode(currentSkill.thinkingMode) }}
              </el-tag>
              <el-tag size="small" effect="plain" :type="effortTagType(currentSkill.reasoningEffort)">
                {{ formatReasoningEffort(currentSkill.reasoningEffort) }}
              </el-tag>
            </div>
            <div class="chip-row">
              <span class="chip-label">runtime</span>
              <el-tag size="small" effect="plain">T={{ currentSkill.temperature ?? '--' }}</el-tag>
              <el-tag size="small" effect="plain">Max={{ currentSkill.maxTokens ?? '--' }}</el-tag>
              <el-tag size="small" effect="plain">{{ formatTimeout(currentSkill.requestTimeoutMs) }}</el-tag>
            </div>
          </div>

          <el-tabs class="skill-workbench__tabs">
            <el-tab-pane label="Prompt 配置">
              <div class="skill-prompt-drawer">
                <div class="prompt-actions">
                  <el-button type="primary" size="small" @click="openCreatePromptDialog">创建新版本</el-button>
                  <el-button v-if="effectivePrompt" size="small" @click="openForkFromActive">基于当前版本修改</el-button>
                  <el-button @click="loadPromptManager">刷新</el-button>
                </div>

                <div v-if="supportsPromptManagement(currentSkill.skillId) && effectivePrompt" class="prompt-active-card">
                  <div class="prompt-summary-card">
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">当前版本</span>
                      <strong>{{ effectivePrompt.version !== null && effectivePrompt.version !== undefined ? `v${effectivePrompt.version}` : '-' }}</strong>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">状态</span>
                      <el-tag size="small" :type="getPromptStatusTagType(effectivePrompt.status)">
                        {{ getPromptStatusLabel(effectivePrompt.status) }}
                      </el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">名称</span>
                      <span>{{ effectivePrompt.name || '-' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">来源</span>
                      <el-tag size="small" :type="promptSourceTagType(effectivePromptSource)">
                        {{ promptSourceLabel(effectivePromptSource) }}
                      </el-tag>
                    </div>
                    <div v-if="promptDriftWarning" class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">代码同步</span>
                      <el-tag size="small" type="danger">DB ACTIVE 与代码默认 Prompt 不一致</el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">运行参数</span>
                      <span>T={{ effectivePrompt.temperature ?? '--' }} | Max={{ effectivePrompt.maxTokens ?? '--' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">模型</span>
                      <span>{{ effectivePrompt.model || '--' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">发布时间</span>
                      <span>{{ formatDateTime(effectivePrompt.publishedAt || effectivePrompt.updatedAt || effectivePrompt.createdAt) }}</span>
                    </div>
                  </div>

                  <div class="prompt-text-card">
                    <div class="prompt-text-card__header">
                      <h4>System Prompt</h4>
                      <el-button v-if="promptPreviewText" type="primary" link @click="promptExpanded = !promptExpanded">
                        {{ promptExpanded ? '收起全文' : '展开全文' }}
                      </el-button>
                    </div>
                    <pre class="sample-json prompt-text-card__content">{{ visiblePromptText }}</pre>
                  </div>
                </div>

                <el-empty v-else-if="supportsPromptManagement(currentSkill.skillId)" description="当前没有可展示的 Prompt。" />
                <el-empty v-else description="该 Skill 当前未开放独立 Prompt 管理" />

                <div v-if="supportsPromptManagement(currentSkill.skillId)" class="prompt-versions-card">
                  <div class="prompt-versions-card__header">
                    <h4>最近版本</h4>
                    <span class="prompt-versions-card__meta">{{ promptVersions.length }} 条</span>
                  </div>
                  <div v-if="promptVersions.length" class="prompt-versions-table">
                    <el-table :data="promptVersions" size="small" border>
                      <el-table-column prop="version" label="版本" width="80" />
                      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
                      <el-table-column label="参数" min-width="120">
                        <template #default="{ row }">
                          <span class="params-inline">T={{ row.temperature ?? '--' }} | {{ row.maxTokens ?? '--' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="状态" width="100">
                        <template #default="{ row }">
                          <el-tag size="small" effect="plain" :type="getPromptStatusTagType(row.status)">
                            {{ getPromptStatusLabel(row.status) }}
                          </el-tag>
                        </template>
                      </el-table-column>
                      <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
                      <el-table-column label="更新时间" min-width="140">
                        <template #default="{ row }">
                          {{ formatDateTime(row.updatedAt || row.createdAt) }}
                        </template>
                      </el-table-column>
                      <el-table-column label="操作" width="180">
                        <template #default="{ row }">
                          <el-tag v-if="row.status === 'ACTIVE'" type="success" size="small" effect="plain">当前生效</el-tag>
                          <el-button type="primary" link size="small" @click="editPromptVersion(row)">编辑</el-button>
                          <el-button v-if="row.status !== 'ACTIVE'" type="success" link size="small" :loading="publishingId === row.id" @click="publishPrompt(row.id)">发布</el-button>
                          <el-button v-if="row.status === 'DRAFT'" type="danger" link size="small" @click="deletePromptDraft(row.id)">删除</el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                  <el-empty v-else description="暂无 Prompt 版本" />
                </div>

                <div v-if="supportsPromptManagement(currentSkill.skillId)" class="prompt-versions-card">
                  <div class="prompt-versions-card__header">
                    <h4>Preview</h4>
                    <el-button @click="runSkillPreview" :loading="previewLoading">运行预览</el-button>
                  </div>
                  <div class="contract-grid contract-grid--preview">
                    <section class="contract-card">
                      <span class="chip-label">Sample Input</span>
                      <el-input
                        v-model="skillPreviewInputText"
                        type="textarea"
                        :rows="16"
                        class="preview-textarea"
                      />
                    </section>
                    <section class="contract-card">
                      <span class="chip-label">Sample Output</span>
                      <pre v-if="skillPreviewOutput !== null" class="sample-json">{{ prettyJson(skillPreviewOutput) }}</pre>
                      <el-empty v-else description="点击“运行预览”查看输出" />
                    </section>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="模型运行时">
              <div class="skill-config-form">
                <el-alert
                  v-if="getSkillHint(editForm.skillId)"
                  :title="getSkillHint(editForm.skillId)"
                  type="info"
                  :closable="false"
                  show-icon
                  class="skill-config-form__notice"
                />
                <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="110px">
                  <el-form-item label="Skill ID">
                    <el-input v-model="editForm.skillId" disabled />
                  </el-form-item>
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

                <div class="skill-config-dialog__footer">
                  <el-button type="warning" :disabled="!currentSkill.enabled" @click="deleteConfig(currentSkill)">恢复默认</el-button>
                  <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <el-dialog v-model="promptEditDialogVisible" :title="`${currentPromptDraftId ? '编辑' : '创建'} Skill Prompt · ${currentPromptSkillId}`" width="720px" destroy-on-close>
      <el-form :model="promptEditForm" label-width="110px" v-loading="promptDetailLoading">
        <el-form-item label="名称">
          <el-input v-model="promptEditForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="promptEditForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="promptEditForm.model" />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="promptEditForm.temperature" :min="0" :max="1" :step="0.1" show-input />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="promptEditForm.maxTokens" :min="100" :max="40000" />
        </el-form-item>
        <el-form-item label="System Prompt">
          <el-input v-model="promptEditForm.systemPrompt" type="textarea" :rows="18" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="promptEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="promptSaving" @click="savePromptDraft">{{ currentPromptDraftId ? '保存修改' : '创建草稿' }}</el-button>
        <el-button v-if="!currentPromptDraftId" type="success" :loading="promptSaving" @click="createAndPublishPrompt">创建并发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { Operation, Refresh } from '@element-plus/icons-vue';
import { adminSkillsApi, adminAgentPromptsApi } from '@/api/adminApi';
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

const skillWorkbenchVisible = ref(false);
const skillWorkbenchLoading = ref(false);
const currentSkill = ref<SkillModelConfig | null>(null);
const saving = ref(false);
const promptDrawerLoading = ref(false);
const currentPromptSkillId = ref('');
const promptVersions = ref<any[]>([]);
const activePrompt = ref<any | null>(null);
const effectivePrompt = ref<any | null>(null);
const effectivePromptSource = ref<'db-active' | 'code-fallback' | ''>('');
const promptDriftWarning = ref(false);
const promptExpanded = ref(false);
const promptEditDialogVisible = ref(false);
const promptSaving = ref(false);
const currentPromptDraftId = ref('');
const publishingId = ref<string | null>(null);
const promptDetailLoading = ref(false);
const previewLoading = ref(false);
const skillPreviewInput = ref<any>(null);
const skillPreviewInputText = ref('');
const skillPreviewOutput = ref<any>(null);
const promptEditForm = ref<any>({
  name: '',
  description: '',
  systemPrompt: '',
  temperature: 0.2,
  maxTokens: 32000,
  model: 'deepseek-v4-pro'
});
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
  'path-scene-framing': 'Path 冷启动输入清洗层：统一收敛 Goal 输出为标准主输入（normalizedInput），再交给 path-agent 主生成。',
  'stage-designer': 'Path 阶段任务设计层：围绕单个 milestone 生成 subtasks，并补轻量任务标签，不直接写 Learn 教案。',
};

const supportsPromptManagement = (skillId?: string) => skillId === 'path-scene-framing' || skillId === 'stage-designer';
const toSkillPromptAgentId = (skillId: string) => `skill:${skillId}`;

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

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return '已生效';
  if (normalized === 'BUILT_IN' || normalized === 'FALLBACK') return '代码内置';
  if (normalized === 'ARCHIVED') return '已归档';
  if (normalized === 'DRAFT') return '草稿';
  if (normalized === 'PUBLISHED') return '已发布';
  if (normalized === 'STAGING') return '预发布';
  return '未知';
};

const getPromptStatusTagType = (status?: string | null) => {
  if (!status) return 'info';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'PUBLISHED') return 'success';
  if (normalized === 'BUILT_IN' || normalized === 'FALLBACK') return 'info';
  if (normalized === 'STAGING') return 'warning';
  if (normalized === 'ARCHIVED') return 'info';
  if (normalized === 'DRAFT') return 'info';
  return 'info';
};

const promptSourceLabel = (source: 'db-active' | 'code-fallback' | '') => {
  if (source === 'db-active') return 'DB Active';
  if (source === 'code-fallback') return 'Code Fallback';
  return 'Unknown';
};

const promptSourceTagType = (source: 'db-active' | 'code-fallback' | '') => {
  if (source === 'db-active') return 'success';
  if (source === 'code-fallback') return 'info';
  return 'info';
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
};

const promptPreviewText = computed(() => effectivePrompt.value?.systemPrompt?.trim() || '');

const visiblePromptText = computed(() => {
  const text = promptPreviewText.value;
  if (!text) return '暂无 Prompt 内容';
  if (promptExpanded.value) return text;

  const lines = text.split('\n');
  if (lines.length <= 8) return text;
  return `${lines.slice(0, 8).join('\n')}\n\n...`;
});

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
};

const openSkillWorkbench = async (row: SkillModelConfig) => {
  skillWorkbenchVisible.value = true;
  skillWorkbenchLoading.value = true;
  currentSkill.value = row;
  currentPromptSkillId.value = row.skillId;
  promptExpanded.value = false;
  skillPreviewOutput.value = null;
  effectivePrompt.value = null;
  effectivePromptSource.value = '';
  promptDriftWarning.value = false;

  editConfig(row);

  skillPreviewInput.value = row.skillId === 'path-scene-framing'
    ? {
        goal: '用 Python 自动化处理销售数据报表中的图表样式调整环节。',
        currentLevel: 'beginner',
        timePerDay: '1 小时/周',
        structuredData: {
          subject: '销售数据报表处理'
        },
        confirmedProposal: {
          learning_direction: '先聚焦图表样式自动化的可复用模板，而不是一次性覆盖整个报表流程。',
          first_deliverable: '一个基于 matplotlib/seaborn 的可复用图表样式函数。',
          key_stages: [
            '学习基本图表库语法并复现当前手动调整的图表样式',
            '将样式参数封装成可复用的函数或样式模板',
            '集成到现有报表脚本中，确保一键运行即可输出标准图表'
          ],
          out_of_scope: [
            '暂时不处理数据清洗、汇总计算等其他自动化环节'
          ]
        },
        metadata: {
          source: 'admin-preview',
          conversationHistory: [
            {
              role: 'user',
              content: '我现在最痛苦的是每次图表出完以后还要手动调颜色、标签和布局。'
            }
          ]
        }
      }
    : null;
  skillPreviewInputText.value = skillPreviewInput.value ? JSON.stringify(skillPreviewInput.value, null, 2) : '';

  try {
    if (supportsPromptManagement(row.skillId)) {
      await loadPromptManager();
    } else {
      promptVersions.value = [];
      activePrompt.value = null;
      effectivePrompt.value = null;
      effectivePromptSource.value = '';
    }
  } finally {
    skillWorkbenchLoading.value = false;
  }
};

const saveConfig = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminSkillsApi.updateSkillModelConfig(editForm.value.skillId, toEditablePayload(editForm.value));
    toast.success('Skill 配置已更新');
    if (currentSkill.value?.skillId === editForm.value.skillId) {
      currentSkill.value = {
        ...currentSkill.value,
        ...editForm.value,
      };
    }
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

const loadPromptManager = async () => {
  if (!currentPromptSkillId.value) return;
  promptDrawerLoading.value = true;
  const agentId = toSkillPromptAgentId(currentPromptSkillId.value);
  try {
    const [versionsRes, activeRes, effectiveRes] = await Promise.allSettled([
      adminAgentPromptsApi.getPromptVersions({ agentId }),
      adminAgentPromptsApi.getActivePrompt(agentId),
      adminSkillsApi.getEffectiveSkillPrompt(currentPromptSkillId.value)
    ]);

    promptVersions.value = versionsRes.status === 'fulfilled'
      ? (versionsRes.value.data?.data?.list || [])
      : [];
      activePrompt.value = activeRes.status === 'fulfilled'
      ? activeRes.value.data?.data || null
      : null;
      effectivePrompt.value = effectiveRes.status === 'fulfilled'
        ? effectiveRes.value.data?.data?.prompt || activePrompt.value
        : activePrompt.value;
      effectivePromptSource.value = effectiveRes.status === 'fulfilled'
        ? (effectiveRes.value.data?.data?.source || '')
        : (activePrompt.value ? 'db-active' : '');
      promptDriftWarning.value = !!(effectiveRes.status === 'fulfilled' && effectiveRes.value.data?.data?.promptDrift);

  } catch (error) {
    toast.error('加载 Skill Prompt 失败');
  } finally {
    promptDrawerLoading.value = false;
  }
};

const openForkFromActive = () => {
  if (!effectivePrompt.value) return;
  currentPromptDraftId.value = '';
  const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1;
  promptEditForm.value = {
    name: `v${nextVersion}-fork`,
    description: `基于 ${effectivePrompt.value.version ? `v${effectivePrompt.value.version}` : '当前版本'} 修改`,
    systemPrompt: effectivePrompt.value.systemPrompt || '',
    temperature: effectivePrompt.value.temperature ?? 0.2,
    maxTokens: effectivePrompt.value.maxTokens ?? 32000,
    model: effectivePrompt.value.model || 'deepseek-v4-pro'
  };
  promptEditDialogVisible.value = true;
};

const editPromptVersion = async (version: any) => {
  promptDetailLoading.value = true;
  try {
    const res = await adminAgentPromptsApi.getPromptDetail(version.id);
    const detail = res.data?.data;

    if ((version.status || '').toUpperCase() === 'DRAFT') {
      currentPromptDraftId.value = version.id;
      promptEditForm.value = {
        name: detail?.name || '',
        description: detail?.description || '',
        systemPrompt: detail?.systemPrompt || '',
        temperature: detail?.temperature ?? 0.2,
        maxTokens: detail?.maxTokens ?? 32000,
        model: detail?.model || 'deepseek-v4-pro'
      };
    } else {
      currentPromptDraftId.value = '';
      const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1;
      promptEditForm.value = {
        name: `v${nextVersion}-修改`,
        description: `基于 v${version.version || '?'} 修改`,
        systemPrompt: detail?.systemPrompt || '',
        temperature: detail?.temperature ?? 0.2,
        maxTokens: detail?.maxTokens ?? 32000,
        model: detail?.model || 'deepseek-v4-pro'
      };
    }

    promptEditDialogVisible.value = true;
  } catch {
    toast.error('加载 Prompt 详情失败');
  } finally {
    promptDetailLoading.value = false;
  }
};

const openCreatePromptDialog = () => {
  currentPromptDraftId.value = '';
  const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1;
  promptEditForm.value = {
    name: `v${nextVersion}`,
    description: '',
    systemPrompt: effectivePrompt.value?.systemPrompt || '',
    temperature: 0.2,
    maxTokens: 32000,
    model: 'deepseek-v4-pro'
  };
  promptEditDialogVisible.value = true;
};

const savePromptDraft = async () => {
  if (!currentPromptSkillId.value || !promptEditForm.value.systemPrompt?.trim()) {
    toast.error('请填写 Prompt 内容');
    return;
  }
  promptSaving.value = true;
  try {
    if (currentPromptDraftId.value) {
      await adminAgentPromptsApi.updatePrompt(currentPromptDraftId.value, promptEditForm.value);
    } else {
      await adminAgentPromptsApi.createPrompt({
        agentId: toSkillPromptAgentId(currentPromptSkillId.value),
        name: promptEditForm.value.name,
        description: promptEditForm.value.description,
        systemPrompt: promptEditForm.value.systemPrompt,
        temperature: promptEditForm.value.temperature,
        maxTokens: promptEditForm.value.maxTokens,
        model: promptEditForm.value.model,
      });
    }
    toast.success('Skill Prompt 草稿已保存');
    promptEditDialogVisible.value = false;
    await loadPromptManager();
  } catch {
    toast.error('保存 Skill Prompt 失败');
  } finally {
    promptSaving.value = false;
  }
};

const createAndPublishPrompt = async () => {
  if (!currentPromptSkillId.value || !promptEditForm.value.systemPrompt?.trim()) {
    toast.error('请填写 Prompt 内容');
    return;
  }

  promptSaving.value = true;
  try {
    const createRes = await adminAgentPromptsApi.createPrompt({
      agentId: toSkillPromptAgentId(currentPromptSkillId.value),
      name: promptEditForm.value.name,
      description: promptEditForm.value.description,
      systemPrompt: promptEditForm.value.systemPrompt,
      temperature: promptEditForm.value.temperature,
      maxTokens: promptEditForm.value.maxTokens,
      model: promptEditForm.value.model,
    });

    const newPromptId = createRes.data?.id || createRes.data?.data?.id;
    if (!newPromptId) {
      toast.error('创建失败，未获取到 Prompt ID');
      return;
    }

    await adminAgentPromptsApi.publishPrompt(newPromptId);
    toast.success('Skill Prompt 已创建并发布');
    promptEditDialogVisible.value = false;
    await loadPromptManager();
  } catch {
    toast.error('创建或发布 Skill Prompt 失败');
  } finally {
    promptSaving.value = false;
  }
};

const deletePromptDraft = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定删除此版本？此操作不可恢复。', '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });

    await adminAgentPromptsApi.deletePrompt(id);
    toast.success('Skill Prompt 草稿已删除');
    await loadPromptManager();
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error('删除 Skill Prompt 失败');
    }
  }
};

const publishPrompt = async (id: string) => {
  publishingId.value = id;
  try {
    await adminAgentPromptsApi.publishPrompt(id);
    toast.success('Skill Prompt 已发布');
    await loadPromptManager();
  } catch {
    toast.error('发布 Skill Prompt 失败');
  } finally {
    publishingId.value = null;
  }
};

const prettyJson = (value: any) => {
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
};

const runSkillPreview = async () => {
  if (!currentPromptSkillId.value || !skillPreviewInputText.value.trim()) return;

  let parsedInput: any;
  try {
    parsedInput = JSON.parse(skillPreviewInputText.value);
  } catch {
    toast.error('Sample Input 不是合法 JSON');
    return;
  }

  skillPreviewInput.value = parsedInput;
  previewLoading.value = true;
  try {
    const res = await adminSkillsApi.testSkill(currentPromptSkillId.value, parsedInput);
    skillPreviewOutput.value = res.data?.data?.output ?? null;
  } catch (error: any) {
    toast.error(error?.response?.data?.error || 'Skill 预览失败');
  } finally {
    previewLoading.value = false;
  }
};

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

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title.admin-page-title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; display: inline-flex; align-items: center; gap: 8px; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
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

.admin-list-card {
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 1rem;
  background: color-mix(in srgb, #ffffff 90%, white);
  backdrop-filter: blur(20px);
  position: relative;
  z-index: 1;
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16);
}

.admin-list-card :deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

.admin-list-card :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
  font-size: 0.8125rem;
  color: #7085a6;
}

.admin-list-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.015);
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

.admin-list-card :deep(.el-table td.el-table__cell) {
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

.skill-workbench {
  display: grid;
  gap: 1rem;
  min-height: 240px;
  padding-right: 4px;
  min-width: 0;
}

.skill-workbench__tabs {
  min-width: 0;
}

.skill-workbench :deep(.el-tabs__content) {
  padding-top: 0.25rem;
}

.skill-workbench :deep(.el-descriptions) {
  width: 100%;
  min-width: 0;
}

.skill-workbench :deep(.el-descriptions__body) {
  overflow-x: auto;
}

.skill-workbench :deep(.el-descriptions__table) {
  min-width: 680px;
}

.chip-section {
  margin-top: 1rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--bg-surface) 60%, white);
  border-radius: var(--radius-md);
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.chip-row:last-child {
  margin-bottom: 0;
}

.chip-label {
  min-width: 80px;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
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

.skill-prompt-drawer {
  padding: 1rem;
  display: grid;
  gap: 1rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.prompt-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.prompt-summary-card,
.prompt-text-card,
.prompt-versions-card {
  border: 1px solid var(--border-light, var(--border-default));
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 0.9rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.prompt-summary-card {
  display: grid;
  gap: 0.7rem;
}

.prompt-summary-card__row,
.prompt-text-card__header,
.prompt-versions-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.prompt-summary-card__label,
.prompt-versions-card__meta,
.params-inline {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.prompt-text-card__header h4,
.prompt-versions-card__header h4 {
  margin: 0;
  color: var(--text-primary);
}

.sample-json {
  font-family: monospace;
  font-size: 0.75rem;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow: auto;
  max-height: 300px;
}

.prompt-text-card__content {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.prompt-versions-table {
  margin-top: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.contract-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  min-width: 0;
}

.contract-grid--preview {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1rem;
}

.contract-card {
  padding: 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--glass-bg-light);
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.contract-card h4 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.contract-card p {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.preview-textarea :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875rem;
  border-radius: 16px;
  background: rgba(52, 120, 246, 0.03);
  border-color: rgba(52, 120, 246, 0.08);
}

:deep(.prompt-versions-table .el-table) {
  width: 100%;
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__inner-wrapper) {
  min-width: 0;
}

:deep(.prompt-versions-table .el-table__body-wrapper) {
  overflow-x: auto;
}

@media (max-width: 1100px) {
  .contract-grid--preview {
    grid-template-columns: 1fr;
  }
}

:deep(.el-dialog) {
  max-width: calc(100vw - 32px);
}

:deep(.el-dialog__body) {
  overflow-x: hidden;
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
