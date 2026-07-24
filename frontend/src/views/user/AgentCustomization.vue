<template>
  <CapabilityShell title="AI 助手">
    <div class="agent-config-page">
      <div class="toolbar">
        <div class="seg">
          <button
            type="button"
            class="seg__btn"
            :class="{ 'seg__btn--on': activeTab === 'all' }"
            @click="setTab('all')"
          >
            全部
          </button>
          <button
            type="button"
            class="seg__btn"
            :class="{ 'seg__btn--on': activeTab === 'system' }"
            @click="setTab('system')"
          >
            平台
          </button>
        </div>
        <div class="stats">
          <span>全部 <strong>{{ agents.length }}</strong></span>
          <span>启用 <strong>{{ enabledCount }}</strong></span>
          <span>关闭 <strong>{{ agents.length - enabledCount }}</strong></span>
        </div>
      </div>

      <el-result
        v-if="loadError && !loading"
        icon="error"
        title="加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadAgents">重新加载</el-button>
        </template>
      </el-result>

      <el-empty v-else-if="!loading && agents.length === 0" description="暂无助手" />

      <div v-else class="agent-table-panel">
        <el-table :data="agents" v-loading="loading" style="width: 100%" row-key="agentName">
          <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.name || row.agentName }}
            </template>
          </el-table-column>
          <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.model || '默认' }}
            </template>
          </el-table-column>
          <el-table-column prop="enabled" label="启用" width="90">
            <template #default="{ row }">
              <el-switch
                v-model="row.enabled"
                @change="toggleAgent(row)"
                :active-value="true"
                :inactive-value="false"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="configPlatformAgent(row)">配置</el-button>
              <el-button link type="primary" @click="viewLogs(row)">日志</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog
        v-model="dialogVisible"
        title="配置"
        width="min(560px, calc(100vw - 32px))"
        @close="resetForm"
      >
        <el-form :model="formData" label-width="100px">
          <el-form-item label="名称">
            <el-input v-model="formData.agentName" disabled />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="formData.model" placeholder="deepseek-v4-flash" />
          </el-form-item>
          <el-form-item label="Temperature">
            <el-input-number v-model="formData.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>
          <el-form-item label="Max Tokens">
            <el-input-number v-model="formData.maxTokens" :min="100" :max="100000" :step="100" />
          </el-form-item>
          <el-form-item label="System Prompt">
            <el-input v-model="formData.systemPrompt" type="textarea" :rows="4" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitForm" :loading="submitting">保存</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="logsVisible" title="调用日志" width="min(720px, calc(100vw - 32px))">
        <el-table :data="agentLogs" style="width: 100%">
          <el-table-column prop="success" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                {{ row.success ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="durationMs" label="耗时" width="90" />
          <el-table-column prop="tokensUsed" label="Token" width="80" />
          <el-table-column prop="error" label="错误" min-width="120" show-overflow-tooltip />
          <el-table-column prop="calledAt" label="时间" width="150">
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
import { computed, ref, reactive, onMounted } from 'vue'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import { toast } from '../../utils/toast'
import {
  getUserAgents,
  saveUserAgent,
  updateUserAgent,
  enableUserAgent,
  disableUserAgent,
  getUserAgentLogs
} from '@/api/userCustom'
import dayjs from 'dayjs'

interface UserAgentItem {
  agentName: string
  name?: string
  description?: string
  enabled?: boolean
  isSystem?: boolean
  userConfigId?: string | null
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  category?: string
}

interface AgentLogItem {
  success?: boolean
  durationMs?: number
  tokensUsed?: number
  error?: string | null
  calledAt?: string
}

const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)
const activeTab = ref('all')
const agents = ref<UserAgentItem[]>([])
const dialogVisible = ref(false)
const logsVisible = ref(false)
const currentAgent = ref<UserAgentItem | null>(null)
const agentLogs = ref<AgentLogItem[]>([])

const enabledCount = computed(() => agents.value.filter((a) => a.enabled).length)

const formData = reactive({
  agentName: '',
  model: '',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: ''
})

onMounted(async () => {
  await loadAgents()
})

function setTab(tab: string) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  loadAgents()
}

const loadAgents = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const params: { filter?: 'all' | 'system' | 'custom' } = {}
    if (activeTab.value !== 'all') {
      params.filter = activeTab.value as 'system' | 'custom'
    }
    const res = await getUserAgents(params)
    agents.value = res.data
  } catch {
    loadError.value = '加载失败'
    toast.error('加载失败')
  } finally {
    loading.value = false
  }
}

const viewLogs = async (agent: UserAgentItem) => {
  try {
    const res = await getUserAgentLogs(agent.agentName, 50)
    agentLogs.value = res.data
    logsVisible.value = true
  } catch {
    toast.error('加载日志失败')
  }
}

const toggleAgent = async (agent: UserAgentItem) => {
  try {
    if (agent.enabled) {
      if (agent.userConfigId) {
        await enableUserAgent(agent.agentName)
      } else if (agent.isSystem) {
        await saveUserAgent({
          agentName: agent.agentName,
          sourceType: 'PLATFORM',
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          systemPrompt: agent.systemPrompt
        })
      }
      toast.success('已启用')
    } else {
      if (agent.userConfigId) {
        await disableUserAgent(agent.agentName)
      } else if (agent.isSystem) {
        await saveUserAgent({
          agentName: agent.agentName,
          sourceType: 'PLATFORM',
          enabled: false,
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          systemPrompt: agent.systemPrompt
        })
      }
      toast.success('已禁用')
    }
  } catch {
    toast.error('操作失败')
    agent.enabled = !agent.enabled
  }
}

const configPlatformAgent = (agent: UserAgentItem) => {
  currentAgent.value = agent
  formData.agentName = agent.agentName
  formData.model = agent.model || 'deepseek-v4-flash'
  formData.temperature = agent.temperature ?? 0.7
  formData.maxTokens = agent.maxTokens || 4096
  formData.systemPrompt = agent.systemPrompt || ''
  dialogVisible.value = true
}

const submitForm = async () => {
  if (!formData.agentName) {
    toast.warning('请填写名称')
    return
  }

  submitting.value = true
  try {
    if (currentAgent.value?.userConfigId) {
      await updateUserAgent(formData.agentName, {
        model: formData.model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        systemPrompt: formData.systemPrompt
      })
    } else {
      await saveUserAgent({
        agentName: formData.agentName,
        sourceType: 'PLATFORM',
        model: formData.model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        systemPrompt: formData.systemPrompt
      })
    }

    toast.success('保存成功')
    dialogVisible.value = false
    loadAgents()
  } catch (error: any) {
    toast.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

const resetForm = () => {
  formData.agentName = ''
  formData.model = ''
  formData.temperature = 0.7
  formData.maxTokens = 4096
  formData.systemPrompt = ''
  currentAgent.value = null
}

const formatDate = (date: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}
</script>

<style scoped lang="scss">
.agent-config-page {
  display: grid;
  gap: 14px;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  gap: 2px;
}

.seg__btn {
  border: 0;
  background: transparent;
  padding: 7px 14px;
  border-radius: 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted, #5b6577);
  cursor: pointer;
}

.seg__btn--on {
  color: var(--blue-deep, #1f57cc);
  background: rgba(52, 120, 246, 0.09);
}

.stats {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted, #5b6577);

  strong {
    color: var(--ink, #172033);
    font-weight: 800;
    margin-left: 4px;
  }
}

.agent-table-panel {
  min-width: 0;
  width: 100%;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid var(--line, #e3e9f4);
  background: #fff;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
  overflow: hidden;
}
</style>
