<template>
  <div class="agent-registry-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
      <div class="bg-orb bg-orb--3"></div>
    </div>

<div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Grid /></el-icon>
        Agent 管理
      </h2>
      <p class="page-hero__subtitle">管理 Agent 的 Prompt 版本、模型配置与运行状态</p>
    </div>

    <div class="summary-grid" v-show="summary" style="position: relative; z-index: 1;">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">已注册</div>
        <div class="value">{{ summary?.total }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">24h 活跃</div>
        <div class="value">{{ summary?.active24h }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">未调用</div>
        <div class="value">{{ summary?.neverCalled }}</div>
      </el-card>
      <el-card class="summary-card summary-card--red" shadow="hover">
        <div class="label">需关注</div>
        <div class="value danger">{{ summary?.unhealthy }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索 Agent ID / 名称" clearable class="search" />
        <el-select v-model="lifecycle" placeholder="发布状态" clearable class="select">
          <el-option label="草稿" value="draft" />
          <el-option label="预发布" value="staging" />
          <el-option label="已发布" value="published" />
        </el-select>
        <el-select v-model="health" placeholder="健康状态" clearable class="select">
          <el-option label="健康" value="healthy" />
          <el-option label="预警" value="warning" />
          <el-option label="异常" value="error" />
          <el-option label="空闲" value="idle" />
        </el-select>
        <el-checkbox v-model="onlyAttention">仅看需关注</el-checkbox>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button @click="seedCorePrompts">
          初始化核心 Prompt
        </el-button>
        <el-button type="primary" @click="loadRegistry" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredAgents" v-loading="loading" stripe style="width: 100%;">
      <el-table-column label="Agent" min-width="280">
        <template #default="{ row }">
          <div class="agent-cell">
            <strong class="agent-cell__name">{{ row.name }}</strong>
            <span class="agent-cell__id">{{ row.agentId }}</span>
            <span class="agent-cell__meta">{{ row.type }} · v{{ row.version }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="140">
        <template #default="{ row }">
          <div class="status-cell">
            <el-tag :type="getRuntimeRoleTagType(row)" size="small">{{ getRuntimeRoleLabel(row) }}</el-tag>
            <el-tag :type="getLifecycleTagType(row.lifecycleStatus)" size="small">{{ row.lifecycleStatus }}</el-tag>
            <el-tag :type="getHealthTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="运行指标" min-width="180">
        <template #default="{ row }">
          <div class="metrics-cell">
            <div class="metrics-cell__row">
              <span>{{ row.callCount }} 调用</span>
              <span :class="rateClass(row.successRate)">{{ row.successRate }}%</span>
            </div>
            <div class="metrics-cell__row metrics-cell__row--sub">
              <span>{{ formatDuration(row.avgDuration) }} 平均</span>
              <span>{{ formatTime(row.lastActivity) }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="Prompt版本" min-width="120">
        <template #default="{ row }">
          <div class="prompt-cell">
            <template v-if="getPromptSummary(row.agentId)?.loading">
              <span class="prompt-cell__muted">加载中...</span>
            </template>
            <template v-else-if="getPromptSummary(row.agentId)?.versionLabel">
              <strong class="prompt-cell__version">{{ getPromptSummary(row.agentId)?.versionLabel }}</strong>
              <el-tag
                size="small"
                effect="plain"
                :type="getPromptStatusTagType(getPromptSummary(row.agentId)?.status)"
              >
                {{ getPromptSummary(row.agentId)?.statusLabel }}
              </el-tag>
            </template>
            <span v-else class="prompt-cell__muted">{{ getPromptSummary(row.agentId)?.existsWithoutActive ? '有版本未激活' : '未配置' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right" align="center">
        <template #default="{ row }">
          <el-button type="primary" link @click="openDesign(row)">查看设计</el-button>
        </template>
      </el-table-column>
      </el-table>
    </div>

    <el-drawer
      v-model="designDrawerVisible"
      :title="`Agent 设计详情 · ${currentDesign?.agentId || ''}`"
      size="min(58%, 800px)"
      destroy-on-close
    >
      <div v-loading="designLoading" class="design-drawer">
        <template v-if="currentDesign">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="名称">{{ currentDesign.basic.name }}</el-descriptions-item>
            <el-descriptions-item label="版本">{{ currentDesign.basic.version }}</el-descriptions-item>
            <el-descriptions-item label="类型">{{ currentDesign.basic.type }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ currentDesign.basic.category }}</el-descriptions-item>
            <el-descriptions-item label="角色">{{ currentDesign.runtime.role }}</el-descriptions-item>
            <el-descriptions-item label="运行类型">{{ currentDesign.runtime.kind }}</el-descriptions-item>
            <el-descriptions-item label="启用状态">
              <el-tag :type="currentDesign.runtime.runtimeEnabled ? 'success' : 'info'" size="small">
                {{ currentDesign.runtime.runtimeEnabled ? 'enabled' : 'disabled' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="输出协议">
              <el-tag :type="currentDesign.runtime.ioContractVersion === 'agent-output-v1' ? 'success' : 'warning'" size="small">
                {{ currentDesign.runtime.ioContractVersion }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="监控分组">{{ currentDesign.runtime.monitoringGroup || '-' }}</el-descriptions-item>
            <el-descriptions-item label="别名">{{ currentDesign.runtime.aliases.join(', ') || '-' }}</el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">{{ currentDesign.basic.description || '-' }}</el-descriptions-item>
          </el-descriptions>

          <div class="chip-section">
            <div class="chip-row">
              <span class="chip-label">capabilities</span>
              <el-tag v-for="item in currentDesign.definition.capabilities" :key="`cap-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.capabilities.length" class="empty">-</span>
            </div>
            <div class="chip-row">
              <span class="chip-label">subscribes</span>
              <el-tag v-for="item in currentDesign.definition.subscribes" :key="`sub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.subscribes.length" class="empty">-</span>
            </div>
            <div class="chip-row">
              <span class="chip-label">publishes</span>
              <el-tag v-for="item in currentDesign.definition.publishes" :key="`pub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.publishes.length" class="empty">-</span>
            </div>
          </div>

          <el-tabs class="design-tabs">
            <el-tab-pane label="Input Schema">
              <el-table :data="inputSchemaRows" border size="small" empty-text="无 input schema">
                <el-table-column prop="path" label="字段路径" min-width="240" />
                <el-table-column prop="type" label="类型" width="120" />
                <el-table-column prop="required" label="必填" width="90" />
                <el-table-column prop="description" label="说明" min-width="220" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="Output Schema">
              <el-table :data="outputSchemaRows" border size="small" empty-text="无 output schema">
                <el-table-column prop="path" label="字段路径" min-width="240" />
                <el-table-column prop="type" label="类型" width="120" />
                <el-table-column prop="required" label="必填" width="90" />
                <el-table-column prop="description" label="说明" min-width="220" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="Prompt 配置">
              <div class="prompt-panel" v-loading="promptDrawerLoading">
                <div class="prompt-actions">
                  <el-button type="primary" size="small" @click="openCreatePromptDialog">
                    <el-icon><Plus /></el-icon>
                    创建新版本
                  </el-button>
                  <el-button v-if="currentPromptActive" size="small" @click="openForkFromActive">
                    基于当前版本修改
                  </el-button>
                </div>
                <el-alert
                  v-if="currentDesign?.runtime.promptManagement?.note"
                  :title="currentDesign.runtime.promptManagement.note"
                  type="info"
                  :closable="false"
                  show-icon
                  class="prompt-notice"
                />
                <template v-if="currentPromptActive">
                  <div class="prompt-summary-card">
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">当前版本</span>
                      <strong>{{ formatPromptVersion(currentPromptActive) }}</strong>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">状态</span>
                      <el-tag size="small" :type="getPromptStatusTagType(currentPromptActive.status)">
                        {{ getPromptStatusLabel(currentPromptActive.status) }}
                      </el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">名称</span>
                      <span>{{ currentPromptActive.name || '-' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">来源</span>
                      <el-tag size="small" :type="promptSourceTagType(currentPromptSource)">
                        {{ promptSourceLabel(currentPromptSource) }}
                      </el-tag>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">运行参数</span>
                      <span>T={{ currentPromptActive.temperature ?? '--' }} | Max={{ currentPromptActive.maxTokens ?? '--' }}</span>
                    </div>
                    <div class="prompt-summary-card__row">
                      <span class="prompt-summary-card__label">发布时间</span>
                      <span>{{ formatTime(currentPromptActive.publishedAt || currentPromptActive.updatedAt || currentPromptActive.createdAt || null) }}</span>
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
                </template>
                <el-empty v-else-if="!promptDrawerLoading" :description="promptEmptyDescription" />

                <div class="prompt-versions-card">
                  <div class="prompt-versions-card__header">
                    <h4>最近版本</h4>
                    <span class="prompt-versions-card__meta">{{ currentPromptVersions.length }} 条</span>
                  </div>
                  <div class="prompt-versions-table">
                    <el-table :data="currentPromptVersions" size="small" border empty-text="暂无 Prompt 版本">
                      <el-table-column label="版本" min-width="80">
                        <template #default="{ row }">
                          {{ formatPromptVersion(row) }}
                        </template>
                      </el-table-column>
                      <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
                      <el-table-column label="参数" min-width="100">
                        <template #default="{ row }">
                          <span class="params-cell">T={{ row.temperature ?? '--' }} | {{ row.maxTokens ?? '--' }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="状态" width="90">
                        <template #default="{ row }">
                          <el-tag size="small" effect="plain" :type="getPromptStatusTagType(row.status)">
                            {{ getPromptStatusLabel(row.status) }}
                          </el-tag>
                        </template>
                      </el-table-column>
                      <el-table-column label="更新时间" min-width="140">
                        <template #default="{ row }">
                          {{ formatTime(row.updatedAt || row.createdAt || null) }}
                        </template>
                      </el-table-column>
                      <el-table-column label="操作" width="160" fixed="right">
                        <template #default="{ row }">
                          <el-button 
                            v-if="row.status !== 'ACTIVE'"
                            type="success"
                            link
                            size="small"
                            @click="publishPromptVersion(row.id)"
                            :loading="publishingId === row.id"
                          >
                            发布
                          </el-button>
                          <el-tag v-if="row.status === 'ACTIVE'" type="success" size="small" effect="plain">当前生效</el-tag>
                          <el-button 
                            type="primary"
                            link
                            size="small"
                            @click="editPromptVersion(row)"
                          >
                            编辑
                          </el-button>
                          <el-button 
                            type="danger"
                            link
                            size="small"
                            @click="deletePromptDraft(row.id)"
                          >
                            删除
                          </el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="模型运行时">
              <div class="model-config-panel" v-loading="modelConfigLoading">
                <template v-if="currentModelConfig">
                  <div class="model-config-card">
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">层级</span>
                      <el-tag size="small">{{ currentModelConfig.tier }}</el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">模型</span>
                      <span>{{ currentModelConfig.model || '平台默认' }}</span>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">思考模式</span>
                      <el-tag size="small" :type="thinkingTagType(currentModelConfig.thinkingMode)">
                        {{ formatThinkingMode(currentModelConfig.thinkingMode) }}
                      </el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">思考强度</span>
                      <el-tag size="small" :type="effortTagType(currentModelConfig.reasoningEffort)">
                        {{ formatReasoningEffort(currentModelConfig.reasoningEffort) }}
                      </el-tag>
                    </div>
                    <div class="model-config-card__row">
                      <span class="model-config-card__label">启用状态</span>
                      <el-switch v-model="currentModelConfig.enabled" @change="updateModelConfigEnabled" />
                    </div>
                  </div>
                  <el-button type="primary" size="small" @click="openEditModelConfigDialog" class="model-config-edit-btn">
                    编辑运行时配置
                  </el-button>
                </template>
                <el-empty v-else-if="!modelConfigLoading" description="当前 Agent 暂无模型配置" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="Recent Samples">
              <div class="sample-block">
                <h4>agent_call_logs</h4>
                <el-collapse>
                  <el-collapse-item
                    v-for="item in currentDesign.samples.agentCallLogs"
                    :key="`call-${item.id}`"
                    :title="`${formatTime(item.calledAt)} · ${item.success ? 'success' : 'error'} · ${item.durationMs || 0}ms`"
                  >
                    <pre class="sample-json">{{ prettyJson({ input: item.input, output: item.output, error: item.error }) }}</pre>
                  </el-collapse-item>
                </el-collapse>
</div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <el-dialog
      v-model="createPromptDialogVisible"
      :title="`${editMode ? '编辑' : '创建'} Prompt 版本 · ${currentDesign?.agentId || ''}`"
      width="min(90%, 720px)"
      destroy-on-close
    >
      <el-form :model="newPromptForm" label-width="100px" v-loading="promptDetailLoading">
        <el-form-item label="版本名称" required>
          <el-input v-model="newPromptForm.name" placeholder="如: v2.0-proposing增强版" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newPromptForm.description" type="textarea" :rows="2" placeholder="版本说明..." />
        </el-form-item>
        <el-form-item label="System Prompt" required>
          <el-input 
            v-model="newPromptForm.systemPrompt" 
            type="textarea" 
            :rows="20"
            placeholder="Agent 系统提示词..."
          />
        </el-form-item>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="Temperature">
              <el-slider v-model="newPromptForm.temperature" :min="0" :max="1" :step="0.1" show-input />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Max Tokens">
              <el-input-number v-model="newPromptForm.maxTokens" :min="100" :max="16000" :step="100" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      
      <template #footer>
        <el-button @click="createPromptDialogVisible = false">取消</el-button>
        <el-button 
          v-if="editMode && editingPromptId"
          type="primary"
          @click="updatePromptDraft"
          :loading="updatingPrompt"
        >
          保存修改
        </el-button>
        <el-button 
          v-if="!editMode"
          type="primary"
          @click="createPromptDraft"
          :loading="creatingPrompt"
        >
          创建草稿
        </el-button>
        <el-button 
          type="success"
          @click="createAndPublishPrompt"
          :loading="creatingPrompt"
        >
          创建并立即发布
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="modelConfigEditDialogVisible"
      title="编辑模型运行时配置"
      width="500px"
      destroy-on-close
    >
      <el-form :model="modelConfigEditForm" label-width="100px">
        <el-form-item label="Agent ID">
          <el-input v-model="modelConfigEditForm.agentId" disabled />
        </el-form-item>
        <el-form-item label="模型层级">
          <el-select v-model="modelConfigEditForm.tier" style="width: 100%">
            <el-option label="chat" value="chat" />
            <el-option label="reasoning" value="reasoning" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="modelConfigEditForm.model" placeholder="留空使用平台默认" />
        </el-form-item>
        <el-form-item label="思考模式">
          <el-select v-model="modelConfigEditForm.thinkingMode" style="width: 100%">
            <el-option label="跟随模型默认" value="default" />
            <el-option label="开启" value="enabled" />
            <el-option label="关闭" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="思考强度">
          <el-select v-model="modelConfigEditForm.reasoningEffort" :disabled="modelConfigEditForm.thinkingMode === 'disabled'" style="width: 100%">
            <el-option label="跟随模型默认" value="default" />
            <el-option label="high" value="high" />
            <el-option label="max" value="max" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="modelConfigEditForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modelConfigEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="modelConfigSaving" @click="saveModelConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Grid, Refresh, Plus } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { adminAgentsApi, adminAgentPromptsApi, adminAxios, type AdminRegistryAgent, type AgentDesignDetail } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const summary = ref<{ total: number; active24h: number; neverCalled: number; unhealthy: number } | null>(null);
const agents = ref<AdminRegistryAgent[]>([]);
const designDrawerVisible = ref(false);
const designLoading = ref(false);
const currentDesign = ref<AgentDesignDetail | null>(null);
const promptDrawerLoading = ref(false);
const promptExpanded = ref(false);
const keyword = ref('');
const lifecycle = ref('');
const health = ref('');
const onlyAttention = ref(false);

interface PromptVersionSummary {
  id: string;
  name?: string;
  version?: number | string;
  versionLabel?: string;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

interface PromptSummaryState {
  loading: boolean;
  versionLabel: string;
  status: string;
  statusLabel: string;
  existsWithoutActive: boolean;
}

interface AgentModelConfig {
  agentId: string;
  tier: string;
  model?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  endpoint?: string;
  apiKey?: string;
  enabled: boolean;
}

const promptSummaries = ref<Record<string, PromptSummaryState>>({});
const currentPromptActive = ref<PromptVersionSummary | null>(null);
const currentPromptVersions = ref<PromptVersionSummary[]>([]);
const currentPromptSource = ref<'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service'>('code-fallback');

const modelConfigLoading = ref(false);
const currentModelConfig = ref<AgentModelConfig | null>(null);
const modelConfigEditDialogVisible = ref(false);
const modelConfigEditForm = ref<AgentModelConfig>({
  agentId: '',
  tier: 'chat',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  enabled: true
});
const modelConfigSaving = ref(false);

const createPromptDialogVisible = ref(false);
const editMode = ref(false);
const editingPromptId = ref<string | null>(null);
const creatingPrompt = ref(false);
const updatingPrompt = ref(false);
const publishingId = ref<string | null>(null);
const promptDetailLoading = ref(false);

const newPromptForm = ref({
  name: '',
  description: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4000
});

const orchestratorIds = new Set([
  'ai-teaching',
  'ai-teaching-agent',
  'requirement-orchestrator',
  'path-orchestrator'
]);

const filteredAgents = computed(() => {
  return agents.value.filter(agent => {
    const byKeyword = !keyword.value || `${agent.agentId} ${agent.name}`.toLowerCase().includes(keyword.value.toLowerCase());
    const byLifecycle = !lifecycle.value || agent.lifecycleStatus === lifecycle.value;
    const byHealth = !health.value || agent.status === health.value;
    const byAttention = !onlyAttention.value || isAttentionAgent(agent);
    return byKeyword && byLifecycle && byHealth && byAttention;
  });
});

const isAttentionAgent = (agent: AdminRegistryAgent) => {
  return agent.status === 'warning' || agent.status === 'error' || agent.callCount === 0;
};

const loadRegistry = async () => {
  loading.value = true;
  try {
    const response: any = await adminAgentsApi.getRegistry();
    summary.value = response.data.data.summary;
    agents.value = response.data.data.agents || [];
    void loadPromptSummaries(agents.value);
  } catch (error) {
    console.error('加载 Agent 注册列表失败:', error);
    toast.error('加载 Agent 注册列表失败');
  } finally {
    loading.value = false;
  }
};

const normalizePromptRecord = (value: any): PromptVersionSummary | null => {
  if (!value || typeof value !== 'object') return null;
  return {
    id: value.id || value.promptId || '',
    name: value.name,
    version: value.version,
    versionLabel: value.versionLabel,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    publishedAt: value.publishedAt,
    systemPrompt: value.systemPrompt,
    temperature: value.temperature,
    maxTokens: value.maxTokens
  };
};

const formatPromptVersion = (prompt: PromptVersionSummary | null | undefined) => {
  if (!prompt) return '-';
  if (prompt.id === '__code_fallback__') return 'built-in';
  if (prompt.versionLabel) return prompt.versionLabel;
  if (prompt.version !== undefined && prompt.version !== null && prompt.version !== '') return `v${prompt.version}`;
  return '-';
};

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知';
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return '已生效';
  if (normalized === 'BUILT_IN') return '代码内置';
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
  if (normalized === 'BUILT_IN') return 'info';
  if (normalized === 'STAGING') return 'warning';
  if (normalized === 'ARCHIVED') return 'info';
  if (normalized === 'DRAFT') return 'info';
  return 'info';
};

const seedCorePrompts = async () => {
  try {
    const response: any = await adminAgentPromptsApi.seedCorePrompts();
    const created = response.data?.data?.result?.created || [];
    const skipped = response.data?.data?.result?.skipped || [];
    const parts = [];
    if (created.length) parts.push(`已创建 ${created.join('、')}`);
    if (skipped.length) parts.push(`已跳过 ${skipped.join('、')}`);
    toast.success(parts.join('；') || '核心 Prompt 已初始化');
    await loadRegistry();
  } catch (error) {
    console.error('初始化核心 Prompt 失败:', error);
    toast.error('初始化核心 Prompt 失败');
  }
};

const getPromptSummary = (agentId: string) => {
  return promptSummaries.value[agentId];
};

const isNotFoundError = (error: unknown) => {
  return typeof error === 'object'
    && error !== null
    && 'response' in error
    && (error as { response?: { status?: number } }).response?.status === 404;
};

const setPromptSummary = (agentId: string, summary: PromptSummaryState) => {
  promptSummaries.value = {
    ...promptSummaries.value,
    [agentId]: summary
  };
};

const pickBestPrompt = (prompts: PromptVersionSummary[]) => {
  if (!Array.isArray(prompts) || prompts.length === 0) return null;

  const activePrompt = prompts.find(prompt => (prompt.status || '').toUpperCase() === 'ACTIVE');
  if (activePrompt) return activePrompt;

  return prompts[0] || null;
};

const buildCodeFallbackPrompt = (agentId: string): PromptVersionSummary | null => {
  const fallbackMap: Record<string, { name: string; systemPrompt: string; temperature?: number; maxTokens?: number }> = {
    'path-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.5,
      maxTokens: 10000,
    },
    'teaching-turn-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    },
    'session-wrapup-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    },
    'peer-agent': {
      name: 'Code fallback',
      systemPrompt: '当前 Agent 使用代码内置默认 Prompt。请先初始化数据库 Prompt 后再在此处做版本化管理。',
      temperature: 0.7,
      maxTokens: 4000,
    }
  };

  const fallback = fallbackMap[agentId];
  if (!fallback) return null;

  return {
    id: '__code_fallback__',
    name: fallback.name,
    versionLabel: 'built-in',
    status: 'BUILT_IN',
    systemPrompt: fallback.systemPrompt,
    temperature: fallback.temperature,
    maxTokens: fallback.maxTokens,
  };
};

const promptSourceLabel = (source: 'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service') => {
  if (source === 'db-active') return 'DB Active';
  if (source === 'db-versioned-no-active') return 'DB Inactive';
  if (source === 'orchestrator-no-direct-prompt') return 'Orchestrator';
  if (source === 'legacy-service') return 'Legacy Service';
  return 'Code Fallback';
};

const promptSourceTagType = (source: 'db-active' | 'db-versioned-no-active' | 'code-fallback' | 'orchestrator-no-direct-prompt' | 'legacy-service') => {
  if (source === 'db-active') return 'success';
  if (source === 'db-versioned-no-active') return 'warning';
  if (source === 'orchestrator-no-direct-prompt') return 'warning';
  if (source === 'legacy-service') return 'info';
  return 'info';
};

const promptEmptyDescription = computed(() => {
  if (currentPromptSource.value === 'orchestrator-no-direct-prompt') {
    return '该编排器本身不直接管理单一 Prompt，请查看成员 agent 的 Prompt 配置';
  }
  if (currentPromptSource.value === 'legacy-service') {
    return '该条目当前更像旧服务概念，不对应独立的数据库 Prompt 管理';
  }
  if (currentPromptSource.value === 'code-fallback') {
    return '当前 Agent 暂无数据库 Prompt，运行时可能仍使用代码内置 Prompt';
  }
  return '当前 Agent 暂无活跃 Prompt';
});

const loadPromptSummaries = async (registryAgents: AdminRegistryAgent[]) => {
  await Promise.allSettled(
    registryAgents.map(async (agent) => {
      setPromptSummary(agent.agentId, {
        loading: true,
        versionLabel: '',
        status: '',
        statusLabel: '',
        existsWithoutActive: false
      });

      try {
        const versionsResponse: any = await adminAgentPromptsApi.getPromptVersions({ agentId: agent.agentId });
        const promptList = versionsResponse.data?.data?.list || versionsResponse.data?.data || [];
        const prompts = Array.isArray(promptList)
          ? promptList.map(normalizePromptRecord).filter(Boolean) as PromptVersionSummary[]
          : [];
        const prompt = pickBestPrompt(prompts);

        if (!prompt) {
          setPromptSummary(agent.agentId, {
            loading: false,
            versionLabel: '',
            status: '',
            statusLabel: '',
            existsWithoutActive: false
          });
          return;
        }

        setPromptSummary(agent.agentId, {
          loading: false,
          versionLabel: formatPromptVersion(prompt),
          status: prompt.status || '',
          statusLabel: getPromptStatusLabel(prompt.status),
          existsWithoutActive: (prompt.status || '').toUpperCase() !== 'ACTIVE'
        });
      } catch {
        setPromptSummary(agent.agentId, {
          loading: false,
          versionLabel: '',
          status: '',
          statusLabel: '',
          existsWithoutActive: false
        });
      }
    })
  );
};

const loadPromptDetails = async (agentId: string) => {
  promptDrawerLoading.value = true;
  currentPromptActive.value = null;
  currentPromptVersions.value = [];
  currentPromptSource.value = 'code-fallback';
  promptExpanded.value = false;

  const promptManagementMode = currentDesign.value?.runtime.promptManagement?.mode;
  if (promptManagementMode === 'orchestrator-no-direct-prompt') {
    currentPromptSource.value = 'orchestrator-no-direct-prompt';
    promptDrawerLoading.value = false;
    return;
  }

  if (promptManagementMode === 'legacy-service') {
    currentPromptSource.value = 'legacy-service';
    promptDrawerLoading.value = false;
    return;
  }

  try {
    const response: any = await adminAgentPromptsApi.getPromptVersions({ agentId });
    const versions = response.data?.data?.list || response.data?.items || [];
    currentPromptVersions.value = Array.isArray(versions)
      ? versions.map(normalizePromptRecord).filter(Boolean).slice(0, 20) as PromptVersionSummary[]
      : [];

    const bestPrompt = pickBestPrompt(currentPromptVersions.value);
    if (bestPrompt?.id) {
      currentPromptSource.value = ((bestPrompt.status || '').toUpperCase() === 'ACTIVE') ? 'db-active' : 'db-versioned-no-active';
      try {
        const detailResponse: any = await adminAgentPromptsApi.getPromptDetail(bestPrompt.id);
        currentPromptActive.value = normalizePromptRecord(detailResponse.data?.data) || bestPrompt;
      } catch (detailError) {
        if (!isNotFoundError(detailError)) {
          console.error('加载 Prompt 详情失败:', detailError);
        }
        currentPromptActive.value = bestPrompt;
      }
    } else {
      currentPromptActive.value = buildCodeFallbackPrompt(agentId);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error('加载 Prompt 版本列表失败:', error);
      toast.error('加载 Prompt 信息失败');
    } else {
      currentPromptActive.value = buildCodeFallbackPrompt(agentId);
    }
  }

  promptDrawerLoading.value = false;
};

interface SchemaRow {
  path: string;
  type: string;
  required: 'yes' | 'no';
  description: string;
}

const toSchemaRows = (schema: any): SchemaRow[] => {
  if (!schema || typeof schema !== 'object') return [];
  const rows: SchemaRow[] = [];

  const walk = (node: any, path: string, requiredList: string[] = []) => {
    if (!node || typeof node !== 'object') return;
    const props = node.properties || {};
    const currentRequired = Array.isArray(node.required) ? node.required : requiredList;

    for (const key of Object.keys(props)) {
      const child = props[key] || {};
      const childPath = path ? `${path}.${key}` : key;
      rows.push({
        path: childPath,
        type: child.type || (child.properties ? 'object' : 'any'),
        required: currentRequired.includes(key) ? 'yes' : 'no',
        description: child.description || ''
      });

      if (child.type === 'object' && child.properties) {
        walk(child, childPath, Array.isArray(child.required) ? child.required : []);
      }
      if (child.type === 'array' && child.items && child.items.properties) {
        walk({ properties: child.items.properties, required: child.items.required || [] }, `${childPath}[]`);
      }
    }
  };

  walk(schema, '');
  return rows;
};

const inputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.inputSchema));
const outputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.outputSchema));

const prettyJson = (value: any) => {
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
};

const openDesign = async (agent: AdminRegistryAgent) => {
  designDrawerVisible.value = true;
  designLoading.value = true;
  currentDesign.value = null;
  currentPromptActive.value = null;
  currentPromptVersions.value = [];
  currentModelConfig.value = null;
  promptExpanded.value = false;

  const agentId = agent.agentId;

  try {
    const designResponse = await adminAgentsApi.getAgentDesign(agentId);
    currentDesign.value = (designResponse as any).data.data;

    const [promptResult, modelConfigResult] = await Promise.allSettled([
      loadPromptDetails(agentId),
      loadModelConfig(agentId)
    ]);

    if (promptResult.status === 'rejected' && !isNotFoundError(promptResult.reason)) {
      console.error('加载 Prompt 信息失败:', promptResult.reason);
    }

    if (modelConfigResult.status === 'rejected' && !isNotFoundError(modelConfigResult.reason)) {
      console.error('加载模型配置失败:', modelConfigResult.reason);
    }
  } catch (error) {
    console.error('加载 Agent 设计失败:', error);
    toast.error('加载 Agent 设计失败');
  } finally {
    designLoading.value = false;
  }
};

const loadModelConfig = async (agentId: string) => {
  modelConfigLoading.value = true;
  try {
    const response = await adminAxios.get(`/admin/agent-model-configs/${agentId}`);
    currentModelConfig.value = response.data?.data || null;
  } catch (error) {
    currentModelConfig.value = null;
  } finally {
    modelConfigLoading.value = false;
  }
};

const updateModelConfigEnabled = async () => {
  if (!currentModelConfig.value) return;
  try {
    await adminAxios.put(`/admin/agent-model-configs/${currentModelConfig.value.agentId}`, {
      enabled: currentModelConfig.value.enabled
    });
    toast.success('状态已更新');
  } catch (error) {
    toast.error('更新失败');
    currentModelConfig.value.enabled = !currentModelConfig.value.enabled;
  }
};

const openEditModelConfigDialog = () => {
  if (!currentModelConfig.value) return;
  modelConfigEditForm.value = {
    ...currentModelConfig.value,
    thinkingMode: currentModelConfig.value.thinkingMode || 'default',
    reasoningEffort: currentModelConfig.value.reasoningEffort || 'default'
  };
  modelConfigEditDialogVisible.value = true;
};

const saveModelConfig = async () => {
  if (!modelConfigEditForm.value.agentId) return;
  modelConfigSaving.value = true;
  try {
    await adminAxios.put(`/admin/agent-model-configs/${modelConfigEditForm.value.agentId}`, {
      tier: modelConfigEditForm.value.tier,
      model: modelConfigEditForm.value.model,
      thinkingMode: modelConfigEditForm.value.thinkingMode,
      reasoningEffort: modelConfigEditForm.value.reasoningEffort,
      enabled: modelConfigEditForm.value.enabled
    });
    toast.success('配置已更新');
    modelConfigEditDialogVisible.value = false;
    if (currentDesign.value) {
      await loadModelConfig(currentDesign.value.agentId);
    }
  } catch (error) {
    toast.error('保存失败');
  } finally {
    modelConfigSaving.value = false;
  }
};

const thinkingTagType = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return 'warning';
  if (thinkingMode === 'disabled') return 'success';
  return 'info';
};

const effortTagType = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return 'warning';
  if (reasoningEffort === 'max') return 'danger';
  return 'info';
};

const formatThinkingMode = (thinkingMode?: 'default' | 'enabled' | 'disabled') => {
  if (thinkingMode === 'enabled') return '开启';
  if (thinkingMode === 'disabled') return '关闭';
  return '模型默认';
};

const formatReasoningEffort = (reasoningEffort?: 'default' | 'high' | 'max') => {
  if (reasoningEffort === 'high') return 'high';
  if (reasoningEffort === 'max') return 'max';
  return '模型默认';
};

const formatTime = (time: string | null) => {
  if (!time) return '从未';
  return new Date(time).toLocaleString('zh-CN');
};

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

const getLifecycleTagType = (status: string) => {
  if (status === 'published') return 'success';
  if (status === 'staging') return 'warning';
  return 'info';
};

const getHealthTagType = (status: string) => {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'danger';
  return 'info';
};

const getRuntimeRole = (agent: AdminRegistryAgent): 'orchestrator' | 'agent' => {
  const roleHint = `${agent.role || ''} ${agent.type || ''}`.toLowerCase();
  if (roleHint.includes('orchestrator')) return 'orchestrator';
  if (orchestratorIds.has(agent.agentId)) return 'orchestrator';
  if (agent.agentId.endsWith('-orchestrator')) return 'orchestrator';
  return 'agent';
};

const getRuntimeRoleLabel = (agent: AdminRegistryAgent) => {
  return getRuntimeRole(agent) === 'orchestrator' ? 'orchestrator' : 'agent';
};

const getRuntimeRoleTagType = (agent: AdminRegistryAgent) => {
  return getRuntimeRole(agent) === 'orchestrator' ? 'warning' : 'info';
};

const rateClass = (rate: number) => {
  if (rate >= 95) return 'rate-good';
  if (rate >= 80) return 'rate-mid';
  return 'rate-bad';
};

const promptPreviewText = computed(() => currentPromptActive.value?.systemPrompt?.trim() || '');

const visiblePromptText = computed(() => {
  const text = promptPreviewText.value;
  if (!text) return '暂无 Prompt 内容';
  if (promptExpanded.value) return text;

  const lines = text.split('\n');
  if (lines.length <= 8) return text;
  return `${lines.slice(0, 8).join('\n')}\n\n...`;
});

const openCreatePromptDialog = () => {
  editMode.value = false;
  editingPromptId.value = null;
  const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
  newPromptForm.value = {
    name: `v${nextVersion}`,
    description: '',
    systemPrompt: currentPromptActive.value?.systemPrompt || '',
    temperature: 0.7,
    maxTokens: 4000
  };
  createPromptDialogVisible.value = true;
};

const openForkFromActive = () => {
  if (!currentPromptActive.value) return;
  editMode.value = false;
  editingPromptId.value = null;
  const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
  newPromptForm.value = {
    name: `v${nextVersion}-fork`,
    description: `基于 ${formatPromptVersion(currentPromptActive.value)} 修改`,
    systemPrompt: currentPromptActive.value.systemPrompt || '',
    temperature: 0.7,
    maxTokens: 4000
  };
  createPromptDialogVisible.value = true;
};

const editPromptVersion = async (version: PromptVersionSummary) => {
  promptDetailLoading.value = true;
  
  try {
    const res: any = await adminAgentPromptsApi.getPromptDetail(version.id);
    const prompt = res.data?.data;
    
    if ((version.status || '').toUpperCase() === 'DRAFT') {
      editMode.value = true;
      editingPromptId.value = version.id;
      newPromptForm.value = {
        name: prompt.name || '',
        description: prompt.description || '',
        systemPrompt: prompt.systemPrompt || '',
        temperature: prompt.temperature ?? 0.7,
        maxTokens: prompt.maxTokens ?? 4000
      };
    } else {
      editMode.value = false;
      editingPromptId.value = null;
      const nextVersion = (Number(currentPromptVersions.value[0]?.version) || 0) + 1;
      newPromptForm.value = {
        name: `v${nextVersion}-修改`,
        description: `基于 ${formatPromptVersion(version)} 修改`,
        systemPrompt: prompt.systemPrompt || '',
        temperature: prompt.temperature ?? 0.7,
        maxTokens: prompt.maxTokens ?? 4000
      };
    }
    createPromptDialogVisible.value = true;
  } catch (error) {
    toast.error('加载 Prompt 详情失败');
  } finally {
    promptDetailLoading.value = false;
  }
};

const createPromptDraft = async () => {
  if (!currentDesign.value?.agentId) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  creatingPrompt.value = true;
  try {
    await adminAgentPromptsApi.createPrompt({
      agentId: currentDesign.value.agentId,
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    toast.success('Prompt 草稿已创建');
    createPromptDialogVisible.value = false;
    await loadPromptDetails(currentDesign.value.agentId);
  } catch (error) {
    toast.error('创建失败');
  } finally {
    creatingPrompt.value = false;
  }
};

const updatePromptDraft = async () => {
  if (!editingPromptId.value) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  updatingPrompt.value = true;
  try {
    await adminAgentPromptsApi.updatePrompt(editingPromptId.value, {
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    toast.success('草稿已更新');
    createPromptDialogVisible.value = false;
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error) {
    toast.error('更新失败');
  } finally {
    updatingPrompt.value = false;
  }
};

const createAndPublishPrompt = async () => {
  if (!currentDesign.value?.agentId) return;
  if (!newPromptForm.value.name || !newPromptForm.value.systemPrompt) {
    toast.error('请填写版本名称和 System Prompt');
    return;
  }
  
  creatingPrompt.value = true;
  try {
    const createRes: any = await adminAgentPromptsApi.createPrompt({
      agentId: currentDesign.value.agentId,
      name: newPromptForm.value.name,
      description: newPromptForm.value.description,
      systemPrompt: newPromptForm.value.systemPrompt,
      temperature: newPromptForm.value.temperature,
      maxTokens: newPromptForm.value.maxTokens
    });
    
    const newPromptId = createRes.data?.id || createRes.data?.data?.id;
    if (newPromptId) {
      await adminAgentPromptsApi.publishPrompt(newPromptId);
      toast.success('已创建并发布');
      createPromptDialogVisible.value = false;
      await loadPromptDetails(currentDesign.value.agentId);
    } else {
      toast.error('创建失败，未获取到 Prompt ID');
    }
  } catch (error) {
    toast.error('创建或发布失败');
  } finally {
    creatingPrompt.value = false;
  }
};

const publishPromptVersion = async (promptId: string) => {
  publishingId.value = promptId;
  try {
    await adminAgentPromptsApi.publishPrompt(promptId);
    toast.success('已发布此版本');
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error) {
    toast.error('发布失败');
  } finally {
    publishingId.value = null;
  }
};

const deletePromptDraft = async (promptId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此版本？此操作不可恢复。', '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    
    await adminAgentPromptsApi.deletePrompt(promptId);
    toast.success('已删除');
    await loadPromptDetails(currentDesign.value?.agentId || '');
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error('删除失败');
    }
  }
};

onMounted(loadRegistry);
</script>

<style scoped>
.agent-registry-page {
  padding: 1.25rem;
  position: relative;
}

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 999px; filter: blur(52px); opacity: 0.42; }
.bg-orb--1 { width: 380px; height: 380px; top: -120px; left: -80px; background: color-mix(in srgb, var(--color-primary) 30%, white); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 320px; height: 320px; top: 12%; right: -80px; background: color-mix(in srgb, var(--color-accent) 22%, white); animation: orb-d 30s ease-in-out infinite reverse; }
.bg-orb--3 { width: 260px; height: 260px; bottom: -70px; left: 24%; background: color-mix(in srgb, var(--color-secondary) 22%, white); animation: orb-d 28s ease-in-out infinite alternate; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 28px; border: 1px solid #d2dbf3; background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), color-mix(in srgb, #ffffff 90%, white); backdrop-filter: blur(20px); margin-bottom: 1.5rem; box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16); }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }


.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.summary-card .label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.summary-card .value {
  color: var(--text-primary);
  font-size: 1.6rem;
  font-weight: 700;
}

.summary-card .value.danger {
  color: var(--color-danger);
}

/* Summary card gradient variants */
.summary-card--blue { border-radius: 28px; background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(52, 120, 246, 0.02)); border: 1px solid rgba(52, 120, 246, 0.1); }
.summary-card--green { border-radius: 28px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.02)); border: 1px solid rgba(16, 185, 129, 0.1); }
.summary-card--orange { border-radius: 28px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02)); border: 1px solid rgba(245, 158, 11, 0.1); }
.summary-card--red { border-radius: 28px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(239, 68, 68, 0.02)); border: 1px solid rgba(239, 68, 68, 0.1); }

.admin-list-card {
  width: 100%;
  background: color-mix(in srgb, #ffffff 90%, white);
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 1rem;
  position: relative;
  z-index: 1;
  backdrop-filter: blur(20px);
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

.admin-list-card :deep(.el-table .el-table__row) {
  position: relative;
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell:first-child::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #3478f6, #8d6bff);
}

.admin-list-card :deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
}

.filters {
  margin-bottom: 1rem;
}

.search {
  width: 260px;
}

.select {
  width: 140px;
}

.rate-good {
  color: var(--color-success);
}

.rate-mid {
  color: var(--color-primary);
}

.rate-bad {
  color: var(--color-danger);
}

.type-cell {
  white-space: nowrap;
}

.agent-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.agent-cell__name {
  color: var(--text-primary);
  font-size: 13px;
}

.agent-cell__id,
.agent-cell__meta {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-cell {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  justify-content: center;
}

.metrics-cell {
  display: grid;
  gap: 4px;
}

.metrics-cell__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-primary);
  font-size: 12px;
}

.metrics-cell__row--sub {
  color: var(--text-secondary);
}

.prompt-cell {
  display: grid;
  gap: 6px;
}

.prompt-cell__version {
  color: var(--text-primary);
  font-size: 13px;
}

.prompt-cell__muted {
  color: var(--text-muted);
  font-size: 12px;
}

.design-drawer {
  padding-right: 0.4rem;
}

.chip-section {
  margin-top: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.chip-label {
  min-width: 92px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.empty {
  color: var(--text-muted);
}

.design-tabs {
  margin-top: 1rem;
}

.sample-block {
  margin-bottom: 1rem;
}

.sample-block h4 {
  margin: 0 0 0.55rem;
  color: var(--text-primary);
}

.sample-json {
  background: var(--bg-secondary);
  padding: 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.prompt-panel {
  display: grid;
  gap: 1rem;
  min-height: 200px;
  min-width: 0;
}

.prompt-summary-card,
.prompt-text-card,
.prompt-versions-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 0.9rem;
  min-width: 0;
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
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.prompt-summary-card__label,
.prompt-versions-card__meta {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.prompt-text-card__header h4,
.prompt-versions-card__header h4 {
  margin: 0;
  color: var(--text-primary);
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

.prompt-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.prompt-notice {
  margin-bottom: 0.25rem;
}

.prompt-actions .el-button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.prompt-versions-table :deep(.el-table__fixed-right) {
  background: rgba(255, 255, 255, 0.72);
}

.prompt-versions-table :deep(.el-button + .el-button) {
  margin-left: 0.25rem;
}

.params-cell {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.model-config-panel {
  padding: 1rem 0;
}

.model-config-card {
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.model-config-card__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.model-config-card__label {
  color: var(--text-secondary);
  font-size: 0.875rem;
  min-width: 80px;
}

.model-config-edit-btn {
  margin-top: 0.5rem;
}

</style>
