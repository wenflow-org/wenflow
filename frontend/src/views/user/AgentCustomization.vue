<template>
  <CapabilityShell title="AI 助手" description="查看平台提供的 AI 助手并控制是否启用。如需调整模型参数，请前往「高级模型」。">
    <div class="agent-config-page">

    <div class="role-overview">
      <el-row :gutter="20">
        <el-col v-for="role in roleCards" :key="role.key" :xs="24" :sm="12" :lg="8">
          <el-card shadow="hover" class="role-card">
            <div class="role-card__header">
              <div>
                <div class="role-card__title">{{ role.label }}</div>
                <div class="role-card__hint">{{ role.description }}</div>
              </div>
              <el-tag :type="role.active ? 'success' : 'info'" size="small">
                {{ role.active ? '已启用' : '未启用' }}
              </el-tag>
            </div>
            <div class="role-card__body">
              <strong>{{ role.agentName }}</strong>
              <span>{{ role.sourceLabel }}</span>
            </div>
            <div class="role-card__footer">{{ role.footer }}</div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 标签页切换 -->
    <el-tabs v-model="activeTab" type="border-card" @tab-change="loadAgents">
       <el-tab-pane label="全部助手" name="all">
         <div class="tab-description">查看平台提供的全部 AI 助手。</div>
      </el-tab-pane>
       <el-tab-pane label="平台助手" name="system">
         <div class="tab-description">平台提供的默认 AI 助手，可以调整启用状态。</div>
      </el-tab-pane>
    </el-tabs>

    <!-- 统计 -->
    <div class="stats">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
               <div class="label">可用助手</div>
              <div class="value">{{ agents.length }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
              <div class="label">已启用</div>
              <div class="value">{{ agents.filter(a => a.enabled).length }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
               <div class="label">平台提供</div>
              <div class="value">{{ agents.filter(a => a.isSystem).length }}</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <div class="stat-item">
               <div class="label">未启用</div>
               <div class="value">{{ agents.filter(a => !a.enabled).length }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- Agent 列表 -->
    <div class="agent-list">
      <el-result
        v-if="loadError && !loading"
        icon="error"
        title="AI 助手加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadAgents">重新加载</el-button>
        </template>
      </el-result>
      <el-empty v-else-if="!loading && agents.length === 0" :description="getEmptyDescription()">
        <template #image>
          <el-icon :size="100" color="var(--el-color-primary)">
            <Reading />
          </el-icon>
        </template>
        <div class="empty-guide" v-if="activeTab === 'system'">
           <p>当前筛选下没有可用的 AI 助手</p>
        </div>
      </el-empty>

      <template v-else>
        <div class="agent-candidate-grid">
          <el-card v-for="agent in featuredAgents" :key="agent.agentName" shadow="hover" class="candidate-card">
            <div class="candidate-card__header">
              <div class="candidate-card__title-row">
                <h3>{{ agent.name || agent.agentName }}</h3>
                <el-tag type="info" size="small">平台默认</el-tag>
              </div>
              <p>{{ agent.description || '暂无描述' }}</p>
            </div>

            <div class="candidate-card__meta">
              <div class="candidate-card__meta-item">
                <span>承担职责</span>
                <div class="role-tags">
                  <el-tag v-for="role in getAgentRoles(agent)" :key="role" size="small" effect="plain">{{ role }}</el-tag>
                  <span v-if="getAgentRoles(agent).length === 0">未标注</span>
                </div>
              </div>
              <div class="candidate-card__meta-item">
                <span>当前模型</span>
                <strong>{{ agent.model || 'deepseek-v4-flash' }}</strong>
              </div>
              <div class="candidate-card__meta-item">
                <span>替换说明</span>
                <strong>{{ getReplacementHint(agent) }}</strong>
              </div>
            </div>

            <div class="candidate-card__footer">
              <el-switch
                v-model="agent.enabled"
                @change="toggleAgent(agent)"
                :active-value="true"
                :inactive-value="false"
              />
              <div class="candidate-card__actions">
                 <el-button link type="primary" @click="configPlatformAgent(agent)">调整参数</el-button>
                 <el-button link type="primary" @click="viewLogs(agent)">查看调用记录</el-button>
              </div>
            </div>
          </el-card>
        </div>

        <div class="agent-table-panel">
          <div class="agent-table-panel__header">
            <div>
              <h3>详细配置</h3>
              <p>保留参数级视图，用于查看模型、来源和更细粒度的开关状态。</p>
            </div>
          </div>

      <el-table :data="agents" v-loading="loading" style="width: 100%" row-key="id">
        <el-table-column prop="name" label="Agent 名称" width="200">
          <template #default="{ row }">
              <div class="agent-name-cell">
                <span>{{ row.name || row.agentName }}</span>
                <el-tag type="info" size="small">托管</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="承担职责" width="200">
            <template #default="{ row }">
              <div class="role-tags">
                <el-tag v-for="role in getAgentRoles(row)" :key="role" size="small" effect="plain">{{ role }}</el-tag>
                <span v-if="getAgentRoles(row).length === 0">-</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="category" label="分类" width="120">
            <template #default="{ row }">
              <el-tag :type="getCategoryType(row.category)" size="small">
                {{ getCategoryLabel(row.category) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="120">
            <template #default="{ row }">
              {{ row.isSystem ? '平台默认' : '未发布' }}
            </template>
          </el-table-column>
          <el-table-column prop="enabled" label="状态" width="100">
            <template #default="{ row }">
              <el-switch
              v-model="row.enabled"
              @change="toggleAgent(row)"
              :active-value="true"
              :inactive-value="false"
            />
          </template>
          </el-table-column>
          <el-table-column prop="model" label="模型" width="150">
            <template #default="{ row }">
              {{ row.model || 'deepseek-v4-flash' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="configPlatformAgent(row)">
              配置
            </el-button>
            <el-button link type="primary" @click="viewLogs(row)">日志</el-button>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </template>
    </div>

    <!-- 托管 Agent 配置对话框 -->
    <el-dialog
      v-model="dialogVisible"
      title="配置 Agent"
      width="min(900px, calc(100vw - 32px))"
      @close="resetForm"
    >
      <el-form :model="formData" label-width="120px">
        <el-form-item label="Agent 名称">
          <el-input v-model="formData.agentName" disabled />
        </el-form-item>
        <el-form-item label="来源类型">
          <el-input value="平台托管" disabled />
        </el-form-item>
        <el-form-item label="AI 模型">
          <el-input v-model="formData.model" placeholder="deepseek-v4-flash" />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-input-number v-model="formData.temperature" :min="0" :max="2" :step="0.1" />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="formData.maxTokens" :min="100" :max="100000" :step="100" />
        </el-form-item>
        <el-form-item label="System Prompt">
          <el-input
            v-model="formData.systemPrompt"
            type="textarea"
            :rows="5"
            placeholder="You are a helpful assistant..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>

    <!-- 日志对话框 -->
    <el-dialog v-model="logsVisible" title="Agent 调用日志" width="min(900px, calc(100vw - 32px))">
      <el-table :data="agentLogs" style="width: 100%">
        <el-table-column prop="success" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="耗时 (ms)" width="100" />
        <el-table-column prop="tokensUsed" label="Token" width="80" />
        <el-table-column prop="error" label="错误" show-overflow-tooltip />
        <el-table-column prop="calledAt" label="时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.calledAt) }}
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue';
import { Reading } from '@element-plus/icons-vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { toast } from '../../utils/toast';
import {
  getUserAgents,
  saveUserAgent,
  updateUserAgent,
  enableUserAgent,
  disableUserAgent,
  getUserAgentLogs
} from '@/api/userCustom';
import dayjs from 'dayjs';

const AGENT_ROLE_MAP: Record<string, string[]> = {
  'skill:goal-conversation': ['需求收集', '对话澄清'],
  'skill:path-planning': ['路径规划'],
  'ai-teaching-agent': ['授课'],
  'learner-model-agent': ['学习者模型']
};

interface UserAgentItem {
  agentName: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  isSystem?: boolean;
  userConfigId?: string | null;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  category?: string;
}

interface AgentLogItem {
  success?: boolean;
  durationMs?: number;
  tokensUsed?: number;
  error?: string | null;
  calledAt?: string;
}

const loading = ref(false);
const loadError = ref('');
const submitting = ref(false);
const activeTab = ref('all');
const agents = ref<UserAgentItem[]>([]);
const dialogVisible = ref(false);
const logsVisible = ref(false);
const currentAgent = ref<UserAgentItem | null>(null);
const agentLogs = ref<AgentLogItem[]>([]);

const roleCards = computed(() => {
  const definitions = [
    { key: 'goal', label: '需求收集', description: '澄清用户目标与上下文', match: ['skill:goal-conversation'] },
    { key: 'path', label: '路径规划', description: '生成学习路径与任务拆分', match: ['skill:path-planning'] },
    { key: 'teaching', label: '授课', description: '生成讲解内容与课堂引导', match: ['ai-teaching-agent'] },
    { key: 'profile', label: '学习者模型', description: '聚合学习者画像、状态、进度信号与知识记忆', match: ['learner-model-agent'] }
  ];

  return definitions.map((definition) => {
    const primary = agents.value.find((item) => definition.match.includes(item.agentName) && item.enabled)
      || agents.value.find((item) => definition.match.includes(item.agentName));

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      active: !!primary?.enabled,
      agentName: primary ? (primary.name || primary.agentName) : '暂无明确候选',
      sourceLabel: primary ? '当前来自平台托管能力' : '需要启用候选 Agent',
      footer: primary?.enabled
        ? '已纳入当前候选能力池'
        : '建议启用一个候选 Agent，作为该职责的可用能力'
    };
  });
});

const featuredAgents = computed(() => {
  const roleFirst = agents.value.filter((item) => getAgentRoles(item).length > 0);
  const extras = agents.value.filter((item) => getAgentRoles(item).length === 0);
  return [...roleFirst, ...extras].slice(0, 6);
});

const formData = reactive({
  agentName: '',
  model: '',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: ''
});

onMounted(async () => {
  await loadAgents();
});

const loadAgents = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const params: { filter?: 'all' | 'system' | 'custom' } = {};
    if (activeTab.value !== 'all') {
      params.filter = activeTab.value as 'system' | 'custom';
    }
    const res = await getUserAgents(params);
    agents.value = res.data;
  } catch (error) {
    loadError.value = '无法读取 AI 助手列表，请检查网络或服务状态后重试。';
    toast.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const viewLogs = async (agent: UserAgentItem) => {
  try {
    const res = await getUserAgentLogs(agent.agentName, 50);
    agentLogs.value = res.data;
    logsVisible.value = true;
  } catch (error) {
    toast.error('加载日志失败');
  }
};

const toggleAgent = async (agent: UserAgentItem) => {
  try {
    if (agent.enabled) {
      if (agent.userConfigId) {
        await enableUserAgent(agent.agentName);
      } else if (agent.isSystem) {
        // 系统 Agent 首次启用，需要创建配置
        await saveUserAgent({
          agentName: agent.agentName,
          sourceType: 'PLATFORM',
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          systemPrompt: agent.systemPrompt
        });
      }
      toast.success('已启用');
    } else {
      if (agent.userConfigId) {
        await disableUserAgent(agent.agentName);
      } else if (agent.isSystem) {
        // 系统 Agent 首次禁用，需要创建配置
        await saveUserAgent({
          agentName: agent.agentName,
          sourceType: 'PLATFORM',
          enabled: false,
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          systemPrompt: agent.systemPrompt
        });
      }
      toast.success('已禁用');
    }
  } catch (error) {
    toast.error('操作失败');
    agent.enabled = !agent.enabled;
  }
};

const configPlatformAgent = (agent: UserAgentItem) => {
  currentAgent.value = agent;
  formData.agentName = agent.agentName;
  formData.model = agent.model || 'deepseek-v4-flash';
  formData.temperature = agent.temperature ?? 0.7;
  formData.maxTokens = agent.maxTokens || 4096;
  formData.systemPrompt = agent.systemPrompt || '';
  dialogVisible.value = true;
};

const getEmptyDescription = () => {
  if (activeTab.value === 'system') {
    return '暂无系统应用';
  } else {
    return '暂无 Agent';
  }
};

const getCategoryType = (category: string) => {
  const types: Record<string, string> = {
    learning: 'primary',
    content: 'success',
    teaching: 'warning',
    tutoring: 'danger',
    tracking: 'info',
    analysis: ''
  };
  return types[category] || 'info';
};

const getCategoryLabel = (category: string) => {
  const labels: Record<string, string> = {
    learning: '学习',
    content: '内容',
    teaching: '授课',
    tutoring: '辅导',
    tracking: '追踪',
    analysis: '分析'
  };
  return labels[category] || category;
};

const getAgentRoles = (agent: UserAgentItem) => {
  return AGENT_ROLE_MAP[agent.agentName] || [];
};

const getReplacementHint = (agent: UserAgentItem) => {
  const roles = getAgentRoles(agent);

  if (agent.isSystem) {
    return roles.length > 0
      ? `当前承担 ${roles.join(' / ')} 默认职责，可调整参数与启用状态。`
      : '平台默认能力，可调整参数。';
  }

  return roles.length > 0
    ? `当前承担 ${roles.join(' / ')} 的候选职责。`
    : '平台托管能力，可单独配置和启用。';
};

const submitForm = async () => {
  if (!formData.agentName) {
    toast.warning('请填写 Agent 名称');
    return;
  }

  submitting.value = true;
  try {
    if (currentAgent.value?.userConfigId) {
      await updateUserAgent(formData.agentName, {
        model: formData.model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        systemPrompt: formData.systemPrompt
      });
    } else {
      await saveUserAgent({
        agentName: formData.agentName,
        sourceType: 'PLATFORM',
        model: formData.model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        systemPrompt: formData.systemPrompt
      });
    }
    
    toast.success('保存成功');
    dialogVisible.value = false;
    loadAgents();
  } catch (error: any) {
    toast.error(error.message || '保存失败');
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  formData.agentName = '';
  formData.model = '';
  formData.temperature = 0.7;
  formData.maxTokens = 4096;
  formData.systemPrompt = '';
  currentAgent.value = null;
};

const formatDate = (date: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};
</script>

<style scoped lang="scss">
.agent-config-page {
  .header-actions {
    display: flex;
    gap: 10px;
  }

  .role-overview {
    margin-bottom: 20px;
  }

  .role-card {
    margin-bottom: 20px;

    &__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }

    &__title {
      font-weight: 700;
      color: var(--el-text-color-primary);
      margin-bottom: 6px;
    }

    &__hint {
      font-size: 13px;
      color: var(--el-text-color-secondary);
      line-height: 1.5;
    }

    &__body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;

      strong {
        color: var(--el-text-color-primary);
      }

      span {
        color: var(--el-text-color-secondary);
        font-size: 13px;
      }
    }

    &__footer {
      font-size: 12px;
      color: var(--el-color-primary);
      font-weight: 600;
    }
  }

  .tab-description {
    padding: 10px 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }

  :deep(.el-tabs),
  .agent-list {
    border-radius: 24px;
    overflow: hidden;
  }

  .stats {
    margin-top: 20px;
    margin-bottom: 20px;

    .stat-item {
      text-align: center;

      .label {
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }

      .value {
        font-size: 24px;
        font-weight: bold;
        color: var(--text-primary);
      }
    }
  }

  :deep(.stats .el-card) {
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(20px);
    border-radius: 20px;
    box-shadow: var(--shadow-md);
  }

  .agent-list {
    margin-top: 20px;

    .agent-candidate-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    .candidate-card {
      border-radius: 24px;

      &__header {
        margin-bottom: 16px;

        p {
          margin: 8px 0 0;
          color: var(--el-text-color-secondary);
          line-height: 1.6;
        }
      }

      &__title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;

        h3 {
          margin: 0;
          font-size: 18px;
          color: var(--el-text-color-primary);
        }
      }

      &__meta {
        display: grid;
        gap: 12px;
        margin-bottom: 16px;
      }

      &__meta-item {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border-radius: 16px;
        background: var(--bg-muted);

        span {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }

        strong {
          font-size: 13px;
          line-height: 1.6;
          color: var(--el-text-color-primary);
          font-weight: 600;
        }
      }

      &__footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      &__actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
    }

    .agent-table-panel {
      padding: 20px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(20px);
      box-shadow: var(--shadow-md);

      &__header {
        margin-bottom: 16px;

        h3 {
          margin: 0 0 8px;
          font-size: 18px;
          color: var(--el-text-color-primary);
        }

        p {
          margin: 0;
          color: var(--el-text-color-secondary);
          line-height: 1.6;
        }
      }
    }

    .empty-guide {
      text-align: center;
      padding: 20px;

      h3 {
        font-size: 18px;
        color: var(--el-text-color-primary);
        margin-bottom: 10px;
      }

      p {
        font-size: 14px;
        color: var(--el-text-color-secondary);
        margin-bottom: 20px;
      }
    }
    
    .agent-name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      
      span {
        font-weight: 500;
      }
    }

    .role-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
  }

  @media (max-width: 1024px) {
    .agent-list {
      .agent-candidate-grid {
        grid-template-columns: 1fr;
      }
    }
  }

  [data-theme="dark"] & {
    .agent-table-panel {
      background: rgba(26, 37, 47, 0.72);
      border-color: rgba(255, 255, 255, 0.1);
    }
  }
}
</style>
