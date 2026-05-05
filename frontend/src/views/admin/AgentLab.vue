<template>
  <div class="agent-lab">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">🤖 Agent 实验室</h2>
        <p class="page-desc">查看和调整平台所有 AI Agent 的配置</p>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="apiConfigDialogVisible = true">
          <el-icon><Setting /></el-icon>
          API 配置
        </el-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <el-skeleton :rows="3" animated v-if="loading" />

    <div v-else>
      <!-- Arena Agents -->
      <div class="section-title">
        <h3>🎯 Arena Agents（演练场）</h3>
        <span class="count">{{ agents.length }} 个</span>
      </div>
      <el-row :gutter="16" class="agent-section">
        <el-col :span="6" v-for="agent in agents" :key="agent.name">
          <el-card 
            class="agent-card" 
            :class="{ active: selectedAgent?.name === agent.name }"
            shadow="hover"
            @click="selectAgentWithVersions(agent)"
          >
            <div class="agent-header">
              <el-icon :size="24" :color="agent.color">
                <component :is="getIcon(agent.icon)" />
              </el-icon>
              <div class="agent-title">
                <h4>{{ agent.name }}</h4>
                <el-tag size="small" :type="agent.status === 'active' ? 'success' : 'info'">
                  {{ agent.status === 'active' ? '运行中' : '开发中' }}
                </el-tag>
                <el-tag size="small" effect="plain" :type="getLifecycleTagType(agent.lifecycleStatus)">
                  {{ getLifecycleTagText(agent.lifecycleStatus) }}
                </el-tag>
              </div>
            </div>
            <p class="agent-desc">{{ agent.description }}</p>
            <div class="agent-meta">
              <span>Temperature: {{ agent.temperature }}</span>
              <span>MaxTokens: {{ agent.maxTokens }}</span>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- Platform Agents -->
      <div class="section-title" style="margin-top: 24px;">
        <h3>⚙️ Platform Agents（平台核心）</h3>
        <span class="count">{{ platformAgents.length }} 个</span>
      </div>
      <el-row :gutter="16" class="agent-section">
        <el-col :span="6" v-for="agent in platformAgents" :key="agent.name">
          <el-card 
            class="agent-card platform-agent"
            :class="{ active: selectedAgent?.name === agent.name }"
            shadow="hover"
            @click="selectAgentWithVersions(agent)"
          >
            <div class="agent-header">
              <el-icon :size="24" :color="agent.color">
                <component :is="getIcon(agent.icon)" />
              </el-icon>
              <div class="agent-title">
                <h4>{{ agent.displayName || agent.name }}</h4>
                <el-tag size="small" type="success">运行中</el-tag>
                <el-tag size="small" effect="plain" :type="getLifecycleTagType(agent.lifecycleStatus)">
                  {{ getLifecycleTagText(agent.lifecycleStatus) }}
                </el-tag>
              </div>
            </div>
            <p class="agent-desc">{{ agent.description }}</p>
            <div class="agent-meta">
              <span>类型: {{ agent.type }}</span>
              <span>调用: {{ agent.stats?.callCount || 0 }}次</span>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- Agent 详情 -->
    <el-card v-if="selectedAgent" class="detail-card" shadow="never">
      <template #header>
        <div class="detail-header">
          <span>{{ selectedAgent.name }} - 配置详情</span>
          <div class="detail-header-actions">
            <el-select v-model="selectedLifecycleStatus" size="small" style="width: 140px;">
              <el-option label="草稿" value="draft" />
              <el-option label="预发布" value="staging" />
              <el-option label="已发布" value="published" />
            </el-select>
            <el-button size="small" @click="saveLifecycleStatus" :loading="savingLifecycleStatus">发布状态</el-button>
            <el-button type="primary" @click="testAgent" :loading="testing">
              <el-icon><VideoPlay /></el-icon>
              快速测试
            </el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <!-- System Prompt -->
        <el-tab-pane label="System Prompt" name="prompt">
          <div class="code-block">
            <div class="code-header">
              <span>角色设定</span>
              <div class="code-actions">
                <el-button text size="small" @click="editPrompt" v-if="selectedAgent.systemPrompt">
                  <el-icon><Edit /></el-icon> 编辑
                </el-button>
                <el-button text size="small" v-if="selectedAgent.systemPrompt" @click="copyToClipboard(selectedAgent.systemPrompt)">
                  <el-icon><DocumentCopy /></el-icon> 复制
                </el-button>
              </div>
            </div>
            <pre v-if="selectedAgent.systemPrompt" class="code-content">{{ selectedAgent.systemPrompt }}</pre>
            <div v-else class="empty-example">
              <p>暂无系统提示词</p>
            </div>
          </div>
        </el-tab-pane>

        <!-- 输入格式 -->
        <el-tab-pane label="输入格式" name="input">
          <div class="format-section">
            <h4>期望输入</h4>
            <el-descriptions :column="1" border>
              <el-descriptions-item label="类型">{{ selectedAgent.input?.type || 'object' }}</el-descriptions-item>
              <el-descriptions-item label="必填字段">
                <el-tag v-for="field in (selectedAgent.input?.required || [])" :key="field" size="small" class="field-tag">
                  {{ field }}
                </el-tag>
                <span v-if="!selectedAgent.input?.required?.length" class="text-muted">无</span>
              </el-descriptions-item>
              <el-descriptions-item label="可选字段">
                <el-tag v-for="field in (selectedAgent.input?.optional || [])" :key="field" size="small" type="info" class="field-tag">
                  {{ field }}
                </el-tag>
                <span v-if="!selectedAgent.input?.optional?.length" class="text-muted">无</span>
              </el-descriptions-item>
            </el-descriptions>
            <div class="code-block mt-16" v-if="selectedAgent.input?.example">
              <div class="code-header">
                <span>示例输入</span>
              </div>
              <pre class="code-content">{{ JSON.stringify(selectedAgent.input.example, null, 2) }}</pre>
            </div>
            <div v-else class="empty-example">
              <p>暂无示例输入</p>
            </div>
          </div>
        </el-tab-pane>

        <!-- 输出格式 -->
        <el-tab-pane label="输出格式" name="output">
          <div class="format-section">
            <h4>期望输出 (JSON)</h4>
            <div class="code-block" v-if="selectedAgent.output?.schema">
              <div class="code-header">
                <span>Schema</span>
              </div>
              <pre class="code-content">{{ JSON.stringify(selectedAgent.output.schema, null, 2) }}</pre>
            </div>
            <div class="code-block mt-16" v-if="selectedAgent.output?.example">
              <div class="code-header">
                <span>示例输出</span>
              </div>
              <pre class="code-content">{{ JSON.stringify(selectedAgent.output.example, null, 2) }}</pre>
            </div>
            <div v-if="!selectedAgent.output?.schema && !selectedAgent.output?.example" class="empty-example">
              <p>暂无输出格式定义</p>
            </div>
          </div>
        </el-tab-pane>

        <!-- 参数配置 -->
        <el-tab-pane label="参数配置" name="params">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="Temperature">
              <el-slider v-model="selectedAgent.temperature" :max="1" :step="0.1" show-stops />
              <span class="param-value">{{ selectedAgent.temperature }} ({{ getTempDesc(selectedAgent.temperature) }})</span>
            </el-descriptions-item>
            <el-descriptions-item label="Max Tokens">
              <el-input-number v-model="selectedAgent.maxTokens" :min="100" :max="4000" :step="100" />
            </el-descriptions-item>
            <el-descriptions-item label="超时时间 (秒)">
              <el-input-number v-model="selectedAgent.timeout" :min="10" :max="300" :step="10" />
            </el-descriptions-item>
            <el-descriptions-item label="重试次数">
              <el-input-number v-model="selectedAgent.retries" :min="0" :max="5" />
            </el-descriptions-item>
          </el-descriptions>
          <div class="actions mt-16">
            <el-button type="primary" @click="saveConfig">保存配置</el-button>
            <el-button @click="resetConfig">重置默认</el-button>
            <el-button type="warning" @click="openAgentOverrideDialog">独立 API 配置</el-button>
          </div>
        </el-tab-pane>

        <!-- 依赖关系 -->
        <el-tab-pane label="依赖关系" name="deps">
          <div class="deps-section">
            <h4>前置依赖</h4>
            <div v-if="selectedAgent.dependencies?.length">
              <el-tag v-for="dep in selectedAgent.dependencies" :key="dep" type="info" class="dep-tag">
                {{ dep }}
              </el-tag>
            </div>
            <p v-else class="text-gray">无前置依赖</p>

            <h4 style="margin-top: 24px;">后续依赖</h4>
            <div v-if="selectedAgent.dependents?.length">
              <el-tag v-for="dep in selectedAgent.dependents" :key="dep" type="success" class="dep-tag">
                {{ dep }}
              </el-tag>
            </div>
            <p v-else class="text-gray">无后续依赖</p>
          </div>
        </el-tab-pane>

        <!-- 版本管理 -->
        <el-tab-pane label="版本管理" name="versions">
          <div class="versions-section">
            <div class="version-header">
              <el-button type="primary" size="small" @click="openNewVersionDialog">
                <el-icon><Plus /></el-icon> 新建版本
              </el-button>
              <el-button size="small" @click="fetchPromptVersions(selectedAgent.name)" :loading="loadingVersions">
                <el-icon><Refresh /></el-icon> 刷新
              </el-button>
            </div>
            
            <el-table :data="promptVersions" v-loading="loadingVersions" style="width: 100%; margin-top: 16px;">
              <el-table-column prop="version" label="版本" width="80">
                <template #default="{ row }">
                  <el-tag size="small">v{{ row.version }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="名称" min-width="150" />
              <el-table-column prop="status" label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="getStatusType(row.status)" size="small">
                    {{ getStatusText(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="useCount" label="调用次数" width="90" />
              <el-table-column prop="avgLatency" label="平均延迟" width="100">
                <template #default="{ row }">
                  {{ row.avgLatency ? `${Math.round(row.avgLatency)}ms` : '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="createdAt" label="创建时间" width="160">
                <template #default="{ row }">
                  {{ new Date(row.createdAt).toLocaleString() }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="180">
                <template #default="{ row }">
                  <el-button text size="small" @click="viewVersionDetail(row.id)">
                    查看
                  </el-button>
                  <el-button 
                    text 
                    size="small" 
                    type="success" 
                    @click="publishVersion(row.id)"
                    v-if="row.status === 'DRAFT'"
                  >
                    发布
                  </el-button>
                  <el-button 
                    text 
                    size="small" 
                    type="warning" 
                    @click="publishVersion(row.id)"
                    v-if="row.status === 'ARCHIVED'"
                  >
                    回滚
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            
            <div v-if="promptVersions.length === 0 && !loadingVersions" class="empty-versions">
              <p>暂无版本记录</p>
              <p class="text-gray">点击"新建版本"创建 Prompt 版本</p>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 测试抽屉 -->
    <el-drawer v-model="testDrawerVisible" title="Agent 快速测试" size="600px">
      <div class="test-panel">
        <h4>输入</h4>
        <el-input
          v-model="testInput"
          type="textarea"
          :rows="6"
          placeholder="输入测试内容..."
        />
        <el-button type="primary" @click="runTest" :loading="testing" class="mt-16">
          运行测试
        </el-button>

        <template v-if="testResult">
          <h4 class="mt-24">输出</h4>
          <div class="code-block">
            <pre class="code-content">{{ JSON.stringify(testResult, null, 2) }}</pre>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- API 配置对话框 -->
    <el-dialog
      v-model="apiConfigDialogVisible"
      title="API 配置"
      width="600px"
    >
      <el-form label-width="120px">
        <el-form-item label="API 端点">
          <el-input v-model="apiConfig.baseURL" placeholder="http://localhost:3000" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="apiConfig.apiKey" placeholder="sk-xxx" show-password />
        </el-form-item>
        <el-form-item label="可用模型">
          <el-input v-model="apiConfig.models" placeholder="deepseek-chat, deepseek-think" />
          <div class="form-tip">多个模型用逗号分隔</div>
        </el-form-item>
        <el-form-item label="默认模型">
          <el-select v-model="apiConfig.defaultModel" placeholder="选择默认模型" style="width: 100%">
            <el-option v-for="model in apiConfig.models.split(',')" :key="model.trim()" :label="model.trim()" :value="model.trim()" />
          </el-select>
        </el-form-item>
        <el-form-item label="推理模型">
          <el-select v-model="apiConfig.defaultReasoningModel" placeholder="选择推理模型" style="width: 100%">
            <el-option v-for="model in apiConfig.models.split(',')" :key="model.trim()" :label="model.trim()" :value="model.trim()" />
          </el-select>
        </el-form-item>
        <el-form-item label="评判模型">
          <el-select v-model="apiConfig.defaultJudgeModel" placeholder="选择评判模型" style="width: 100%">
            <el-option v-for="model in apiConfig.models.split(',')" :key="model.trim()" :label="model.trim()" :value="model.trim()" />
          </el-select>
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="testApiConnection" :loading="testingConnection">
          测试连接
        </el-button>
        <el-button @click="apiConfigDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveApiConfig">保存</el-button>
      </template>
    </el-dialog>

    <!-- Agent 独立 API 配置对话框 -->
    <el-dialog
      v-model="agentOverrideDialogVisible"
      :title="`${selectedAgent?.name || 'Agent'} 独立 API 配置`"
      width="500px"
    >
      <el-alert
        title="独立配置说明"
        type="info"
        :closable="false"
        style="margin-bottom: 16px;"
      >
        启用独立配置后，此 Agent 将使用自己的模型和参数，而不是平台默认配置。
      </el-alert>
      
      <el-form label-width="100px">
        <el-form-item label="启用独立配置">
          <el-switch v-model="agentOverrideConfig.useCustom" />
        </el-form-item>
        
        <template v-if="agentOverrideConfig.useCustom">
          <el-form-item label="使用模型">
            <el-select v-model="agentOverrideConfig.model" placeholder="使用平台默认" clearable style="width: 100%">
              <el-option label="使用平台默认" value="" />
              <el-option v-for="m in apiConfig.models.split(',')" :key="m.trim()" :label="m.trim()" :value="m.trim()" />
            </el-select>
            <div class="form-tip">留空则使用平台默认模型</div>
          </el-form-item>
          
          <el-form-item label="Temperature">
            <el-slider v-model="agentOverrideConfig.temperature" :min="0" :max="1" :step="0.1" show-stops />
            <span class="param-value">{{ agentOverrideConfig.temperature }}</span>
          </el-form-item>
          
          <el-form-item label="Max Tokens">
            <el-input-number v-model="agentOverrideConfig.maxTokens" :min="100" :max="4000" :step="100" />
          </el-form-item>
        </template>
      </el-form>
      
      <template #footer>
        <el-button @click="agentOverrideDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAgentOverrideConfig">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑 System Prompt 对话框 -->
    <el-dialog
      v-model="promptEditDialogVisible"
      :title="`${selectedAgent?.name || 'Agent'} - 编辑 System Prompt`"
      width="800px"
    >
      <el-alert
        title="System Prompt 编辑"
        type="info"
        :closable="false"
        style="margin-bottom: 16px;">
        <template #default>
          <p>编辑此Agent的系统提示词。修改后将影响所有使用此Agent的地方（Arena、正式平台等）。</p>
        </template>
      </el-alert>

      <el-form label-width="100px">
        <el-form-item label="System Prompt">
          <el-input
            v-model="editedPrompt"
            type="textarea"
            :rows="20"
            placeholder="输入系统提示词..."
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="promptEditDialogVisible = false">取消</el-button>
        <el-button @click="resetPrompt">重置</el-button>
        <el-button type="primary" @click="savePrompt">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新建版本对话框 -->
    <el-dialog
      v-model="newVersionDialogVisible"
      title="新建 Prompt 版本"
      width="700px"
    >
      <el-form :model="newVersionForm" label-width="100px">
        <el-form-item label="版本名称" required>
          <el-input v-model="newVersionForm.name" placeholder="如: GoalConversationAgent v2" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newVersionForm.description" type="textarea" :rows="2" placeholder="版本描述..." />
        </el-form-item>
        <el-form-item label="System Prompt" required>
          <el-input
            v-model="newVersionForm.systemPrompt"
            type="textarea"
            :rows="12"
            placeholder="输入系统提示词..."
          />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-slider v-model="newVersionForm.temperature" :min="0" :max="1" :step="0.1" show-stops />
          <span class="param-value">{{ newVersionForm.temperature }}</span>
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="newVersionForm.maxTokens" :min="100" :max="8000" :step="100" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="newVersionDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createNewVersion">创建版本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { adminAxios } from '@/api/adminApi'
import {
  User,
  ChatDotRound,
  Filter,
  DocumentChecked,
  Trophy,
  MagicStick,
  VideoPlay,
  DocumentCopy,
  MapLocation,
  Document,
  ChatDotSquare,
  TrendCharts,
  Cpu,
  Setting,
  Edit,
  Plus,
  Refresh
} from '@element-plus/icons-vue'
import { toast } from '../../utils/toast';

const activeTab = ref('prompt')
const selectedAgent = ref<any>(null)
const testDrawerVisible = ref(false)
const testing = ref(false)
const testInput = ref('')
const testResult = ref<any>(null)
const loading = ref(false)
const selectedLifecycleStatus = ref<'draft' | 'staging' | 'published'>('draft')
const savingLifecycleStatus = ref(false)

// 版本管理相关
const promptVersions = ref<any[]>([])
const loadingVersions = ref(false)
const currentActiveVersion = ref<any>(null)

// API 配置相关
const apiConfigDialogVisible = ref(false)
const apiConfig = reactive({
  baseURL: '',
  apiKey: '',
  models: '',
  defaultModel: '',
  defaultReasoningModel: '',
  defaultJudgeModel: ''
})
const testingConnection = ref(false)
const connectionTestResult = ref<any>(null)

// Agent 独立配置相关
const agentOverrideDialogVisible = ref(false)
const agentOverrideConfig = reactive({
  model: '',
  temperature: 0.8,
  maxTokens: 2000,
  useCustom: false
})

// Prompt 编辑相关
const promptEditDialogVisible = ref(false)
const editedPrompt = ref('')
const originalPrompt = ref('')

// 新建版本相关
const newVersionDialogVisible = ref(false)
const newVersionForm = reactive({
  name: '',
  description: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 2000
})

// Agent 配置数据
const agents = reactive<any[]>([])
const platformAgents = reactive<any[]>([])

// 图标映射
const iconMap: Record<string, any> = {
  'User': User,
  'ChatDotRound': ChatDotRound,
  'Filter': Filter,
  'DocumentChecked': DocumentChecked,
  'Trophy': Trophy,
  'MagicStick': MagicStick,
  'MapLocation': MapLocation,
  'Document': Document,
  'ChatDotSquare': ChatDotSquare,
  'TrendCharts': TrendCharts,
  'Cpu': Cpu
}

// 获取 Agent 列表
async function fetchAgents() {
  loading.value = true
  try {
    const response = await adminAxios.get('/admin/agent-lab/agents')
    if (response.data.success) {
      // 清空现有数据
      agents.length = 0
      platformAgents.length = 0
      
      // 添加 Arena agents
      if (response.data.data.arena) {
        agents.push(...response.data.data.arena)
      }
      
      // 添加 Platform agents
      if (response.data.data.platform) {
        platformAgents.push(...response.data.data.platform)
      }
      
      // 默认选中第一个
      if (agents.length > 0 && !selectedAgent.value) {
        selectAgent(agents[0])
      }
    }
  } catch (error: any) {
    toast.error('获取 Agent 配置失败: ' + (error.message || '未知错误'))
    console.error('Failed to fetch agents:', error)
  } finally {
    loading.value = false
  }
}

// 获取图标组件
function getIcon(iconName: string) {
  return iconMap[iconName] || Cpu
}

// 页面加载时获取数据
onMounted(() => {
  fetchAgents()
  fetchApiConfig()
})

// 获取 API 配置
async function fetchApiConfig() {
  try {
    const response = await adminAxios.get('/admin/agent-lab/api-config')
    if (response.data.success) {
      const data = response.data.data
      apiConfig.baseURL = data.baseURL || ''
      apiConfig.apiKey = data.apiKeyRaw || ''
      apiConfig.models = data.models?.join(', ') || ''
      apiConfig.defaultModel = data.defaultModel || ''
      apiConfig.defaultReasoningModel = data.defaultReasoningModel || ''
      apiConfig.defaultJudgeModel = data.defaultJudgeModel || ''
    }
  } catch (error: any) {
    console.error('Failed to fetch API config:', error)
  }
}

// ============ 版本管理功能 ============

// 获取 Agent 的 Prompt 版本列表
async function fetchPromptVersions(agentId: string) {
  loadingVersions.value = true
  try {
    const response = await adminAxios.get(`/admin/agent-prompts?agentId=${agentId}`)
    if (response.data.success) {
      promptVersions.value = response.data.data.list || []
      // 找到当前活跃版本
      currentActiveVersion.value = promptVersions.value.find((v: any) => v.status === 'ACTIVE') || null
    }
  } catch (error: any) {
    console.error('Failed to fetch prompt versions:', error)
    promptVersions.value = []
  } finally {
    loadingVersions.value = false
  }
}

// 打开新建版本对话框
function openNewVersionDialog() {
  if (!selectedAgent.value) return
  newVersionForm.name = `${selectedAgent.value.name} v${(promptVersions.value.length || 0) + 1}`
  newVersionForm.description = ''
  newVersionForm.systemPrompt = selectedAgent.value.systemPrompt || ''
  newVersionForm.temperature = selectedAgent.value.temperature || 0.7
  newVersionForm.maxTokens = selectedAgent.value.maxTokens || 2000
  newVersionDialogVisible.value = true
}

// 创建新版本
async function createNewVersion() {
  if (!selectedAgent.value) return
  try {
    const response = await adminAxios.post('/admin/agent-prompts', {
      agentId: selectedAgent.value.name,
      name: newVersionForm.name,
      description: newVersionForm.description,
      systemPrompt: newVersionForm.systemPrompt,
      temperature: newVersionForm.temperature,
      maxTokens: newVersionForm.maxTokens
    })
    if (response.data.success) {
      toast.success('新版本已创建')
      newVersionDialogVisible.value = false
      await fetchPromptVersions(selectedAgent.value.name)
    }
  } catch (error: any) {
    toast.error('创建失败: ' + (error.message || '未知错误'))
  }
}

// 发布版本
async function publishVersion(versionId: string) {
  try {
    const response = await adminAxios.put(`/admin/agent-prompts/${versionId}/publish`)
    if (response.data.success) {
      toast.success('版本已发布')
      if (selectedAgent.value) {
        await fetchPromptVersions(selectedAgent.value.name)
      }
    }
  } catch (error: any) {
    toast.error('发布失败: ' + (error.message || '未知错误'))
  }
}

// 查看版本详情
async function viewVersionDetail(versionId: string) {
  try {
    const response = await adminAxios.get(`/admin/agent-prompts/detail/${versionId}`)
    if (response.data.success) {
      const detail = response.data.data
      editedPrompt.value = detail.systemPrompt
      originalPrompt.value = detail.systemPrompt
      promptEditDialogVisible.value = true
    }
  } catch (error: any) {
    toast.error('获取版本详情失败: ' + (error.message || '未知错误'))
  }
}

// 获取状态标签类型
function getStatusType(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'success'
    case 'DRAFT': return 'warning'
    case 'ARCHIVED': return 'info'
    default: return ''
  }
}

// 获取状态文本
function getStatusText(status: string): string {
  switch (status) {
    case 'ACTIVE': return '当前版本'
    case 'DRAFT': return '草稿'
    case 'ARCHIVED': return '已归档'
    default: return status
  }
}

// 保存 API 配置
async function saveApiConfig() {
  try {
    const response = await adminAxios.put('/admin/agent-lab/api-config', {
      baseURL: apiConfig.baseURL,
      apiKey: apiConfig.apiKey,
      models: apiConfig.models,
      defaultModel: apiConfig.defaultModel,
      defaultReasoningModel: apiConfig.defaultReasoningModel,
      defaultJudgeModel: apiConfig.defaultJudgeModel
    })
    if (response.data.success) {
      toast.success('API 配置已保存')
      apiConfigDialogVisible.value = false
    }
  } catch (error: any) {
    toast.error('保存失败: ' + (error.message || '未知错误'))
  }
}

// 测试 API 连接
async function testApiConnection() {
  testingConnection.value = true
  connectionTestResult.value = null
  try {
    const response = await adminAxios.post('/admin/agent-lab/api-config/test', {
      baseURL: apiConfig.baseURL,
      apiKey: apiConfig.apiKey
    })
    connectionTestResult.value = response.data
    if (response.data.success) {
      toast.success('API 连接成功！')
    } else {
      toast.error('API 连接失败: ' + response.data.error)
    }
  } catch (error: any) {
    connectionTestResult.value = { success: false, error: error.message }
    toast.error('连接测试失败: ' + (error.message || '未知错误'))
  } finally {
    testingConnection.value = false
  }
}

// 打开 Agent 独立配置对话框
function openAgentOverrideDialog() {
  if (!selectedAgent.value) return
  
  // 获取当前 Agent 的独立配置
  agentOverrideConfig.useCustom = false
  agentOverrideConfig.model = selectedAgent.value.model || ''
  agentOverrideConfig.temperature = selectedAgent.value.temperature || 0.8
  agentOverrideConfig.maxTokens = selectedAgent.value.maxTokens || 2000
  
  // 如果已有配置，显示自定义
  if (selectedAgent.value.model || selectedAgent.value.useOverride) {
    agentOverrideConfig.useCustom = true
  }
  
  agentOverrideDialogVisible.value = true
}

// 保存 Agent 独立配置
async function saveAgentOverrideConfig() {
  if (!selectedAgent.value) return

  try {
    if (agentOverrideConfig.useCustom) {
      // 保存独立配置
      await adminAxios.put(`/admin/agent-lab/agents/${selectedAgent.value.name}/config`, {
        model: agentOverrideConfig.model || undefined,
        temperature: agentOverrideConfig.temperature,
        maxTokens: agentOverrideConfig.maxTokens
      })
      selectedAgent.value.useOverride = true
      selectedAgent.value.model = agentOverrideConfig.model
      selectedAgent.value.temperature = agentOverrideConfig.temperature
      selectedAgent.value.maxTokens = agentOverrideConfig.maxTokens
      toast.success('Agent 独立配置已保存')
    } else {
      // 删除独立配置，使用平台默认
      await adminAxios.delete(`/admin/agent-lab/agents/${selectedAgent.value.name}/config`)
      selectedAgent.value.useOverride = false
      toast.success('Agent 配置已重置为平台默认')
    }
    agentOverrideDialogVisible.value = false
  } catch (error: any) {
    toast.error('保存失败: ' + (error.message || '未知错误'))
  }
}

// 编辑 System Prompt
function editPrompt() {
  if (!selectedAgent.value) return
  editedPrompt.value = selectedAgent.value.systemPrompt || ''
  originalPrompt.value = selectedAgent.value.systemPrompt || ''
  promptEditDialogVisible.value = true
}

// 选择 Agent 时加载版本
function selectAgentWithVersions(agent: any) {
  selectAgent(agent)
  fetchPromptVersions(agent.name)
}

// 保存 System Prompt
async function savePrompt() {
  if (!selectedAgent.value) return

  try {
    await adminAxios.put(`/admin/agent-lab/agents/${selectedAgent.value.name}/prompt`, {
      prompt: editedPrompt.value
    })
    selectedAgent.value.systemPrompt = editedPrompt.value
    toast.success('System Prompt 已保存')
    promptEditDialogVisible.value = false
  } catch (error: any) {
    toast.error('保存失败: ' + (error.message || '未知错误'))
  }
}

// 重置 System Prompt
function resetPrompt() {
  editedPrompt.value = originalPrompt.value
  toast.info('已重置为原始值')
}

// 原始硬编码数据作为 fallback
const fallbackAgents = reactive([
  {
    name: 'PersonaAgent',
    description: '生成用户画像 - 基于输入创建真实学习者画像',
    icon: 'User',
    color: '#409EFF',
    status: 'active',
    temperature: 0.8,
    maxTokens: 8000,  // 与后端配置保持一致
    timeout: 60,
    retries: 2,
    systemPrompt: `你是用户画像生成专家。
请根据以下要求生成一个真实的学习者画像：

画像格式：
{
  "surfaceGoal": "表面目标（如：我想学Python）",
  "realProblem": "真问题（如：自动化Excel报表处理）",
  "level": "当前水平（初学者/中级/高级）",
  "timePerDay": "每天可用时间（如：1小时）",
  "totalWeeks": "期望完成时间（如：8周）",
  "motivation": "学习动机",
  "urgency": "紧迫程度（高/中/低）",
  "background": {
    "priorKnowledge": ["已有知识1", "已有知识2"],
    "learningHistory": "过往学习经历",
    "challenges": ["面临的挑战1", "面临的挑战2"]
  },
  "personality": {
    "type": "性格类型",
    "preference": "学习偏好"
  }
}`,
    input: {
      type: 'string | object',
      required: ['prompt'],
      optional: ['config'],
      example: '请生成一个典型的职场人士学习画像，目标是提升工作效率。'
    },
    output: {
      schema: {
        surfaceGoal: 'string - 表面目标',
        realProblem: 'string - 真问题',
        level: 'string - 当前水平',
        timePerDay: 'string - 每日可用时间',
        totalWeeks: 'string - 期望周期',
        motivation: 'string - 学习动机',
        urgency: 'string - 紧迫程度',
        background: 'object - 背景信息',
        personality: 'object - 性格特征'
      },
      example: {
        surfaceGoal: '我想学Python',
        realProblem: '自动化Excel报表处理，减少重复性手工操作',
        level: '初学者',
        timePerDay: '45分钟',
        totalWeeks: '10周',
        motivation: '提升工作效率，增强职场竞争力',
        urgency: '高',
        background: {
          priorKnowledge: ['Excel常用函数', '基础数据透视'],
          learningHistory: '大学学过一点C语言但早已忘记',
          challenges: ['工作忙，很难保证固定学习时间', '面对大量学习资源不知从何入手']
        },
        personality: {
          type: '务实、自律但容易焦虑',
          preference: '偏好项目驱动式学习，喜欢边做边学'
        }
      }
    },
    dependencies: [],
    dependents: ['DialogAgent']
  },
  {
    name: 'DialogAgent',
    description: '对话模拟 - 模拟用户与系统的多轮对话',
    icon: 'ChatDotRound',
    color: '#67C23A',
    status: 'active',
    temperature: 0.7,
    maxTokens: 2000,
    timeout: 120,
    retries: 2,
    systemPrompt: '你是对话模拟专家。基于用户画像，模拟一个真实的用户与AI学习助手进行多轮对话。',
    input: {
      type: 'object',
      required: ['persona'],
      optional: ['maxTurns', 'topics'],
      example: { persona: '{用户画像对象}', maxTurns: 5 }
    },
    output: {
      schema: {
        messages: 'array - 对话记录',
        messageCount: 'number - 总消息数',
        userMessageCount: 'number - 用户消息数',
        aiMessageCount: 'number - AI消息数'
      },
      example: {
        messages: [
          { role: 'user', content: '你好，我想学习Python' },
          { role: 'assistant', content: '很高兴帮助你！能告诉我你的学习目标吗？' }
        ],
        messageCount: 10,
        userMessageCount: 5,
        aiMessageCount: 5
      }
    },
    dependencies: ['PersonaAgent'],
    dependents: ['ExtractAgent']
  },
  {
    name: 'ExtractAgent',
    description: '信息提取 - 从对话中提取结构化学习需求',
    icon: 'Filter',
    color: '#E6A23C',
    status: 'active',
    temperature: 0.3,
    maxTokens: 1500,
    timeout: 60,
    retries: 3,
    systemPrompt: '你是信息提取专家。从对话记录中提取关键学习需求信息，并评估完整性。',
    input: {
      type: 'array',
      required: ['messages'],
      optional: [],
      example: { messages: [{ role: 'user', content: '...' }] }
    },
    output: {
      schema: {
        surfaceGoal: 'string',
        realProblem: 'string',
        level: 'string',
        timePerDay: 'string',
        totalWeeks: 'string',
        completenessScore: 'number - 完整度评分',
        missingFields: 'array - 缺失字段'
      },
      example: {
        surfaceGoal: '我想学Python',
        realProblem: '自动化报表处理',
        level: '初学者',
        timePerDay: '1小时',
        totalWeeks: '8周',
        completenessScore: 85,
        missingFields: ['motivation']
      }
    },
    dependencies: ['DialogAgent'],
    dependents: ['GenerateAgent']
  },
  {
    name: 'GenerateAgent',
    description: '路径生成 - 生成学习方案和路径',
    icon: 'DocumentChecked',
    color: '#F56C6C',
    status: 'active',
    temperature: 0.5,
    maxTokens: 3000,
    timeout: 180,
    retries: 2,
    systemPrompt: '你是学习路径设计专家。基于提取的需求信息，设计完整的学习方案和学习路径。',
    input: {
      type: 'object',
      required: ['extraction'],
      optional: [],
      example: { extraction: '{提取结果对象}' }
    },
    output: {
      schema: {
        proposal: 'object - 学习方案',
        learningPath: 'object - 学习路径',
        totalWeeks: 'number',
        totalTasks: 'number'
      },
      example: {
        proposal: { totalWeeks: 8, weeklyHours: 7 },
        learningPath: { weeks: [{ week: 1, tasks: [] }] },
        totalWeeks: 8,
        totalTasks: 24
      }
    },
    dependencies: ['ExtractAgent'],
    dependents: ['EvaluateAgent']
  },
  {
    name: 'EvaluateAgent',
    description: '质量评判 - 评判整个流程的质量',
    icon: 'Trophy',
    color: '#9B59B6',
    status: 'active',
    temperature: 0.3,
    maxTokens: 2000,
    timeout: 120,
    retries: 2,
    systemPrompt: '你是质量评判专家。评判整个学习路径生成流程的质量，找出问题并给出改进建议。',
    input: {
      type: 'object',
      required: ['persona', 'dialogue', 'extraction', 'generation'],
      optional: [],
      example: { persona: {}, dialogue: {}, extraction: {}, generation: {} }
    },
    output: {
      schema: {
        overallScore: 'number - 综合评分',
        dimensionScores: 'object - 各维度评分',
        report: 'object - 评判报告',
        suggestions: 'array - 改进建议'
      },
      example: {
        overallScore: 85,
        dimensionScores: { persona: 90, dialogue: 85, extraction: 80, proposal: 85, path: 85 },
        report: { strengths: [], weaknesses: [], issues: [] },
        suggestions: [{ aspect: '对话策略', suggestion: '...' }]
      }
    },
    dependencies: ['GenerateAgent'],
    dependents: ['OptimizeAgent']
  },
  {
    name: 'OptimizeAgent',
    description: 'Prompt优化 - 基于评判结果优化Prompt',
    icon: 'MagicStick',
    color: '#1ABC9C',
    status: 'active',
    temperature: 0.5,
    maxTokens: 2500,
    timeout: 120,
    retries: 2,
    systemPrompt: '你是Prompt优化专家。根据评判结果，优化各Agent的Prompt。',
    input: {
      type: 'object',
      required: ['evaluation'],
      optional: [],
      example: { evaluation: '{评判结果}' }
    },
    output: {
      schema: {
        suggestions: 'array - 优化建议',
        optimizedPrompts: 'object - 优化后的Prompts',
        expectedImprovement: 'object - 预期改进'
      },
      example: {
        suggestions: [{ agent: 'DialogAgent', issue: '...', solution: '...' }],
        optimizedPrompts: { DialogAgent: '...', ExtractAgent: '...' },
        expectedImprovement: { extractionScore: '预期提升5-10分' }
      }
    },
    dependencies: ['EvaluateAgent'],
    dependents: []
  }
])

function selectAgent(agent: any) {
  selectedAgent.value = agent
  selectedLifecycleStatus.value = agent.lifecycleStatus || 'draft'
  activeTab.value = 'prompt'
  testInput.value = typeof agent?.input?.example === 'string' 
    ? agent.input.example 
    : JSON.stringify(agent?.input?.example || {}, null, 2)
}

function getLifecycleTagType(status: string): 'info' | 'warning' | 'success' {
  switch (status) {
    case 'published':
      return 'success'
    case 'staging':
      return 'warning'
    default:
      return 'info'
  }
}

function getLifecycleTagText(status: string) {
  switch (status) {
    case 'published':
      return '已发布'
    case 'staging':
      return '预发布'
    default:
      return '草稿'
  }
}

async function saveLifecycleStatus() {
  if (!selectedAgent.value) return
  savingLifecycleStatus.value = true
  try {
    await adminAxios.put(`/admin/agent-lab/agent-catalog/${selectedAgent.value.name}/status`, {
      status: selectedLifecycleStatus.value
    })
    selectedAgent.value.lifecycleStatus = selectedLifecycleStatus.value
    toast.success('发布状态已更新')
    await fetchAgents()
  } catch (error: any) {
    toast.error('更新失败: ' + (error.message || '未知错误'))
  } finally {
    savingLifecycleStatus.value = false
  }
}

function getTempDesc(temp: number) {
  if (temp <= 0.3) return '保守'
  if (temp <= 0.7) return '平衡'
  return '创意'
}

function getAgentStatus(name: string) {
  const agent = agents.find(a => a.name === name)
  return agent?.status || 'inactive'
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已复制到剪贴板')
}

function testAgent() {
  testDrawerVisible.value = true
  testResult.value = null
}

async function runTest() {
  if (!selectedAgent.value) return
  
  testing.value = true
  testResult.value = null
  
  try {
    const response = await adminAxios.post(
      `/admin/agent-lab/agents/${selectedAgent.value.name}/test`,
      { input: testInput.value }
    )
    
    if (response.data.success) {
      testResult.value = response.data.data
      toast.success('测试完成')
    } else {
      toast.error('测试失败: ' + (response.data.error || '未知错误'))
    }
  } catch (error: any) {
    toast.error('测试请求失败: ' + (error.message || '未知错误'))
    console.error('Test failed:', error)
  } finally {
    testing.value = false
  }
}

function saveConfig() {
  // 实际应用中这里应该调用 API 保存配置
  toast.success('配置已保存（演示模式 - 实际应调用后端API）')
}

function resetConfig() {
  fetchAgents()
  toast.info('已重置为默认配置')
}

</script>

<style scoped lang="scss">
.agent-lab {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  
  h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }
  
  .count {
    color: var(--text-secondary);
    font-size: 14px;
  }
}

.agent-section {
  margin-bottom: 16px;
}

.page-header {
  margin-bottom: 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  
  .page-title {
    margin: 0 0 8px 0;
    font-size: 24px;
  }
  
  .page-desc {
    color: var(--text-secondary);
    margin: 0;
  }
  
  .header-left {
    flex: 1;
  }
  
  .header-right {
    flex-shrink: 0;
  }
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.agent-card {
  cursor: pointer;
  margin-bottom: 16px;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.32);
  
  &:hover {
    transform: translateY(-2px);
  }
  
  &.active {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-md);
  }
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  
  .agent-title {
    h4 {
      margin: 0 0 4px 0;
      font-size: 16px;
    }
  }
}

.agent-desc {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.agent-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-card {
  margin-top: 24px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.code-block {
  border: 1px solid var(--border-default);
  border-radius: 4px;
  overflow: hidden;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.72);
  border-bottom: 1px solid var(--border-default);
  font-size: 13px;
  font-weight: 500;
}

.code-content {
  padding: 12px;
  margin: 0;
  background: rgba(255, 255, 255, 0.72);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.format-section h4 {
  margin: 0 0 16px 0;
  color: var(--text-primary);
}

.field-tag {
  margin-right: 8px;
  margin-bottom: 4px;
}

.param-value {
  margin-left: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.deps-section h4 {
  margin: 0 0 16px 0;
  color: var(--text-primary);
}

.dep-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}

.text-gray {
  color: var(--text-secondary);
}

.mt-16 {
  margin-top: 16px;
}

.mt-24 {
  margin-top: 24px;
}

.actions {
  display: flex;
  gap: 12px;
}

.test-panel {
  padding: 0 20px;
  
  h4 {
    margin: 0 0 12px 0;
    color: var(--text-primary);
  }
}

// 版本管理样式
.versions-section {
  .version-header {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }
}

.empty-versions {
  text-align: center;
  padding: 40px 0;
  color: var(--text-secondary);
  
  p {
    margin: 4px 0;
  }
}

[data-theme="dark"] .agent-card,
[data-theme="dark"] .code-block,
[data-theme="dark"] .code-header,
[data-theme="dark"] .code-content {
  background: rgba(30, 45, 58, 0.74);
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
