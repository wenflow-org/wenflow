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

      <div v-if="loadError && !loading" class="uc-card">
        <div class="uc-errorbar" role="alert">
          {{ loadError }}
          <button type="button" class="uc-errorbar__retry" @click="loadAgents">重新加载</button>
        </div>
      </div>

      <div v-else-if="loading && !agents.length" class="uc-card">
        <div class="uc-loading">
          <span class="uc-spinner"></span>
          加载助手列表…
        </div>
      </div>

      <div v-else-if="!loading && agents.length === 0" class="uc-empty">
        <strong>暂无助手</strong>
        <span>平台托管 Agent 会出现在这里</span>
      </div>

      <article v-else class="uc-card uc-card--flush">
        <div class="uc-table-wrap">
          <table class="uc-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>模型</th>
                <th>启用</th>
                <th class="uc-table__right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="agent in agents" :key="agent.agentName">
                <td>
                  {{ agent.name || agent.agentName }}
                  <span v-if="agent.description" class="uc-table__sub">{{ agent.description }}</span>
                </td>
                <td class="uc-table__muted">{{ agent.model || '默认' }}</td>
                <td>
                  <label class="uc-switch">
                    <input
                      type="checkbox"
                      v-model="agent.enabled"
                      :disabled="togglingAgents.has(agent.agentName)"
                      @change="toggleAgent(agent)"
                    />
                    <span class="uc-switch__track"></span>
                  </label>
                </td>
                <td class="uc-table__right">
                  <button type="button" class="uc-btn uc-btn--link" @click="configPlatformAgent(agent)">配置</button>
                  <button type="button" class="uc-btn uc-btn--link" @click="viewLogs(agent)">日志</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <!-- 配置弹窗 -->
      <div v-if="dialogVisible" class="uc-dialog-mask" @click.self="dialogVisible = false">
        <div class="uc-dialog" role="dialog" aria-modal="true" aria-label="Agent 配置">
          <div class="uc-dialog__head">
            <h3>配置 · {{ formData.agentName }}</h3>
            <button type="button" class="uc-dialog__close" aria-label="关闭" @click="closeDialog">✕</button>
          </div>
          <div class="uc-dialog__body">
            <label class="uc-field">
              <span class="uc-field__label">模型</span>
              <input v-model="formData.model" class="uc-field__input" placeholder="deepseek-v4-flash" />
            </label>
            <div class="form-grid">
              <label class="uc-field">
                <span class="uc-field__label">Temperature</span>
                <input v-model.number="formData.temperature" type="number" min="0" max="2" step="0.1" class="uc-field__input" />
              </label>
              <label class="uc-field">
                <span class="uc-field__label">Max Tokens</span>
                <input v-model.number="formData.maxTokens" type="number" min="100" max="100000" step="100" class="uc-field__input" />
              </label>
            </div>
            <label class="uc-field">
              <span class="uc-field__label">System Prompt</span>
              <textarea v-model="formData.systemPrompt" class="uc-field__input" rows="4"></textarea>
            </label>
          </div>
          <div class="uc-dialog__foot">
            <button type="button" class="uc-btn" :disabled="submitting" @click="closeDialog">取消</button>
            <button type="button" class="uc-btn uc-btn--primary" :disabled="submitting" @click="submitForm">
              {{ submitting ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 调用日志弹窗 -->
      <div v-if="logsVisible" class="uc-dialog-mask" @click.self="logsVisible = false">
        <div class="uc-dialog uc-dialog--wide" role="dialog" aria-modal="true" aria-label="调用日志">
          <div class="uc-dialog__head">
            <h3>调用日志 · {{ currentLogAgent }}</h3>
            <button type="button" class="uc-dialog__close" aria-label="关闭" @click="logsVisible = false">✕</button>
          </div>
          <div class="uc-dialog__body">
            <div v-if="!agentLogs.length" class="uc-empty">
              <strong>暂无日志</strong>
              <span>该 Agent 还没有调用记录</span>
            </div>
            <div v-else class="uc-table-wrap">
              <table class="uc-table">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>Token</th>
                    <th>错误</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(log, i) in agentLogs" :key="i">
                    <td><span class="uc-badge" :class="log.success ? 'uc-badge--ok' : 'uc-badge--bad'">
                      {{ log.success ? '成功' : '失败' }}
                    </span></td>
                    <td class="uc-table__muted">{{ log.durationMs ?? '-' }}</td>
                    <td class="uc-table__muted">{{ log.tokensUsed ?? '-' }}</td>
                    <td class="uc-table__muted">{{ log.error || '-' }}</td>
                    <td class="uc-table__muted">{{ formatDate(log.calledAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="uc-dialog__foot">
            <button type="button" class="uc-btn" @click="logsVisible = false">关闭</button>
          </div>
        </div>
      </div>
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
import '@/components/user/uc.css'

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
const togglingAgents = ref<Set<string>>(new Set())
const activeTab = ref('all')
const agents = ref<UserAgentItem[]>([])
const dialogVisible = ref(false)
const logsVisible = ref(false)
const currentAgent = ref<UserAgentItem | null>(null)
const currentLogAgent = ref('')
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
    currentLogAgent.value = agent.name || agent.agentName
    logsVisible.value = true
  } catch {
    toast.error('加载日志失败')
  }
}

const toggleAgent = async (agent: UserAgentItem) => {
  // 行级防重复提交：快速连点不再并发触发 enable/disable
  if (togglingAgents.value.has(agent.agentName)) return;
  togglingAgents.value.add(agent.agentName);
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
  } finally {
    togglingAgents.value.delete(agent.agentName)
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

const closeDialog = () => {
  if (submitting.value) return
  dialogVisible.value = false
  resetForm()
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

const formatDate = (date?: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}
</script>

<style scoped>
.agent-config-page {
  display: grid;
  gap: 16px;
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
  background: var(--canvas, #f3f6fb);
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.uc-dialog--wide {
  width: min(720px, 100%);
}
</style>
