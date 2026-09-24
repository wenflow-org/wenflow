<template>
  <CapabilityShell title="API 接入">
    <div class="user-settings-page">
      <!-- 状态条 -->
      <div class="settings-status">
        <div class="settings-status__left">
          <span class="uc-badge" :class="apiConfig.enabled ? 'uc-badge--ok' : 'uc-badge--muted'">
            {{ apiConfig.enabled ? '已启用' : '未启用' }}
          </span>
          <div>
            <strong>{{ apiConfig.enabled ? '使用自定义模型服务' : '使用平台默认模型服务' }}</strong>
            <p>对话模型 {{ apiConfig.chatModel || 'deepseek-v4-flash' }} · 推理模型 {{ apiConfig.reasoningModel || 'deepseek-v4-pro' }}</p>
          </div>
        </div>
        <label class="uc-switch" :class="{ 'uc-switch--off': !apiConfig.enabled }">
          <input
            type="checkbox"
            v-model="apiConfig.enabled"
            :disabled="busy"
            @change="handleEnabledChange"
          />
          <span class="uc-switch__track"></span>
          <span class="uc-switch__label">{{ apiConfig.enabled ? '启用' : '禁用' }}</span>
        </label>
      </div>

      <div v-if="loadError" class="uc-errorbar" role="alert">
        {{ loadError }}
        <button type="button" class="uc-errorbar__retry" @click="loadApiConfig">重新加载</button>
      </div>

      <div v-if="loading" class="uc-card">
        <div class="uc-loading">
          <span class="uc-spinner"></span>
          加载配置…
        </div>
      </div>

      <div v-else-if="!loadError" class="settings-cols">
        <!-- 左：配置表单 -->
        <article class="uc-card">
          <div class="uc-card__head">
            <div>
              <h3>服务配置</h3>
              <p>填写兼容 OpenAI 协议的自定义模型端点</p>
            </div>
          </div>
          <div class="api-form">
            <label class="uc-field">
              <span class="uc-field__label">端点</span>
              <input v-model="apiConfig.endpoint" class="uc-field__input" placeholder="例如 https://api.openai.com/v1" :disabled="busy" />
            </label>

            <label class="uc-field">
              <span class="uc-field__label">API Key</span>
              <div class="uc-field__pwd">
                <input
                  v-model="apiConfig.apiKey"
                  :type="showKey ? 'text' : 'password'"
                  class="uc-field__input"
                  :placeholder="hasSavedApiKey ? '已保存，留空继续使用' : '例如 sk-xxxxxxxx'"
                  :disabled="busy"
                />
                <button type="button" class="uc-field__eye" @click="showKey = !showKey" :aria-label="showKey ? '隐藏密钥' : '显示密钥'">
                  {{ showKey ? '隐藏' : '显示' }}
                </button>
              </div>
              <span v-if="hasSavedApiKey" class="uc-field__hint">已保存密钥，留空则继续使用</span>
            </label>

            <div class="api-form__grid">
              <label class="uc-field">
                <span class="uc-field__label">对话模型</span>
                <input v-model="apiConfig.chatModel" class="uc-field__input" list="api-model-options" placeholder="deepseek-v4-flash" :disabled="busy" />
              </label>
              <label class="uc-field">
                <span class="uc-field__label">推理模型</span>
                <input v-model="apiConfig.reasoningModel" class="uc-field__input" list="api-model-options" placeholder="deepseek-v4-pro" :disabled="busy" />
              </label>
              <datalist id="api-model-options">
                <option v-for="m in modelOptions" :key="m" :value="m" />
              </datalist>
            </div>
            <div v-if="modelOptions.length" class="model-options-hint">
              来自端点的可用模型：<span v-for="m in modelOptions.slice(0, 6)" :key="m" class="model-chip">{{ m }}</span>
              <span v-if="modelOptions.length > 6" class="model-more">等 {{ modelOptions.length }} 个</span>
            </div>

            <div class="action-buttons">
              <button type="button" class="uc-btn" :disabled="busy" @click="testConnection">
                {{ testing ? '测试中…' : '测试连接' }}
              </button>
              <button type="button" class="uc-btn" :disabled="busy" @click="loadModels">
                {{ loadingModels ? '获取中…' : '获取模型' }}
              </button>
              <button type="button" class="uc-btn uc-btn--primary" :disabled="busy" @click="saveApiConfig">
                {{ saving ? '保存中…' : '保存配置' }}
              </button>
              <button v-if="apiConfig.enabled" type="button" class="uc-btn uc-btn--danger" :disabled="busy" @click="disableConfig">
                {{ disabling ? '禁用中…' : '禁用' }}
              </button>
            </div>
          </div>
        </article>

        <!-- 右：说明卡 -->
        <aside class="settings-side">
          <article class="uc-card">
            <div class="uc-card__head">
              <div>
                <h3>什么是自定义 API？</h3>
              </div>
            </div>
            <ul class="help-list">
              <li><strong>自带模型服务</strong><span>接入你自己购买的模型服务（DeepSeek / OpenAI / 兼容端点），学习对话将使用你的模型</span></li>
              <li><strong>平台默认</strong><span>不配置时使用平台内置模型，无需任何操作</span></li>
              <li><strong>密钥安全</strong><span>API Key 加密存储，仅用于平台调用你的模型服务</span></li>
            </ul>
            <div class="help-tip">
              需要帮助？将配置问题反馈给开发者，可附上调用日志。
            </div>
          </article>
        </aside>
      </div>

      <!-- 我的 MCP 工具（独立于自定义 API 的加载状态） -->
      <article class="uc-card">
        <div class="uc-card__head">
          <div>
            <h3>我的 MCP 工具</h3>
            <p>接入你自己的 MCP 服务或 HTTP 工具，供学习对话按需调用</p>
          </div>
          <button type="button" class="uc-btn uc-btn--primary" @click="openMcpCreate">新增工具</button>
        </div>

        <div v-if="mcpError" class="uc-errorbar" role="alert">
          {{ mcpError }}
          <button type="button" class="uc-errorbar__retry" @click="loadMcpConfig">重新加载</button>
        </div>
        <div v-else-if="mcpLoading" class="uc-loading">
          <span class="uc-spinner"></span>
          加载 MCP 工具…
        </div>
        <p v-else-if="!mcpTools.length" class="mcp-empty">
          还没有配置 MCP 工具。新增一个 MCP 服务后，它的工具会由服务端自动发现。
        </p>
        <ul v-else class="mcp-list">
          <li v-for="t in mcpTools" :key="t.id" class="mcp-item">
            <span class="mcp-item__kind" :class="{ 'is-mcp': t.transport === 'mcp' }">
              {{ t.transport === 'mcp' ? 'MCP' : 'HTTP' }}
            </span>
            <div class="mcp-item__main">
              <strong>{{ t.name }}</strong>
              <span class="mcp-item__sub" :title="t.endpoint">{{ t.id }} · {{ t.endpoint }}</span>
            </div>
            <span class="uc-badge" :class="t.enabled ? 'uc-badge--ok' : 'uc-badge--muted'">
              {{ t.enabled ? '启用' : '停用' }}
            </span>
            <input
              v-if="t.transport === 'mcp'"
              v-model="mcpToolName[t.id]"
              class="uc-field__input mcp-item__toolname"
              placeholder="工具名，如 tavily_search"
              :disabled="mcpTestingId === t.id"
            />
            <div class="mcp-item__actions">
              <button type="button" class="uc-btn" :disabled="mcpTestingId === t.id" @click="testMcpTool(t)">
                {{ mcpTestingId === t.id ? '测试中…' : '测试' }}
              </button>
              <button type="button" class="uc-btn" :disabled="mcpSaving" @click="openMcpEdit(t)">编辑</button>
              <button type="button" class="uc-btn uc-btn--danger" :disabled="mcpSaving" @click="removeMcpTool(t)">删除</button>
            </div>
          </li>
        </ul>

        <!-- 新增 / 编辑表单 -->
        <div v-if="mcpFormOpen" class="mcp-form">
          <div class="api-form__grid">
            <label class="uc-field">
              <span class="uc-field__label">ID</span>
              <input v-model="mcpForm.id" class="uc-field__input" placeholder="如 my-search" :disabled="!!mcpEditingId" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">名称</span>
              <input v-model="mcpForm.name" class="uc-field__input" placeholder="如 我的搜索服务" />
            </label>
          </div>
          <div class="api-form__grid">
            <label class="uc-field">
              <span class="uc-field__label">连接方式</span>
              <select v-model="mcpForm.transport" class="uc-field__input">
                <option value="http">HTTP 接口</option>
                <option value="mcp">MCP 服务</option>
              </select>
            </label>
            <label class="uc-field">
              <span class="uc-field__label">状态</span>
              <select v-model="mcpForm.enabled" class="uc-field__input">
                <option :value="true">启用</option>
                <option :value="false">停用</option>
              </select>
            </label>
          </div>
          <label class="uc-field">
            <span class="uc-field__label">{{ mcpForm.transport === 'mcp' ? 'MCP 服务地址' : 'Endpoint' }}</span>
            <input
              v-model="mcpForm.endpoint"
              class="uc-field__input"
              :placeholder="mcpForm.transport === 'mcp' ? 'https://…/mcp' : 'https://…'"
            />
          </label>
          <label class="uc-field">
            <span class="uc-field__label">API Key（可选）</span>
            <input
              v-model="mcpForm.apiKey"
              type="password"
              class="uc-field__input"
              :placeholder="mcpFormHadKey ? '已保存，留空继续使用' : '如 sk-…'"
            />
          </label>
          <p v-if="mcpForm.transport === 'mcp'" class="mcp-hint">
            MCP 服务的工具由服务端 <code>tools/list</code> 自动发现，无需逐个登记；测试与调用时以
            <code>{{ mcpForm.id || 'id' }}:&lt;toolName&gt;</code> 寻址。
          </p>
          <div class="action-buttons">
            <button type="button" class="uc-btn uc-btn--primary" :disabled="mcpSaving" @click="saveMcpTool">
              {{ mcpSaving ? '保存中…' : '保存' }}
            </button>
            <button type="button" class="uc-btn" :disabled="mcpSaving" @click="mcpFormOpen = false">取消</button>
          </div>
        </div>
      </article>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { askConfirm, doneConfirm, failConfirm } from '@/views/admin-redesign/useConfirm';
import { toast } from '../../utils/toast';
import {
  disableUserApiConfig,
  executeMcpTool,
  fetchApiModels,
  getUserApiConfig,
  getUserMcpConfig,
  testApiConnection,
  updateUserApiConfig,
  updateUserMcpConfig,
  type UserMcpToolConfig
} from '@/api/userCustom';
import '@/components/user/uc.css';

const saving = ref(false);
const testing = ref(false);
const loading = ref(false);
const loadError = ref('');
const disabling = ref(false);
const hasSavedApiKey = ref(false);
const showKey = ref(false);
const loadingModels = ref(false);
const modelOptions = ref<string[]>([]);
const busy = computed(() => loading.value || saving.value || testing.value || disabling.value || loadingModels.value);

// 单配置模式
const apiConfig = reactive({
  enabled: false,
  endpoint: '',
  apiKey: '',
  chatModel: 'deepseek-v4-flash',
  reasoningModel: 'deepseek-v4-pro',
});

onMounted(async () => {
  await Promise.all([loadApiConfig(), loadMcpConfig()]);
});

const loadApiConfig = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await getUserApiConfig();
    const data = res.data;
    apiConfig.enabled = data.enabled || false;
    apiConfig.endpoint = data.endpoint || '';
    apiConfig.apiKey = '';
    hasSavedApiKey.value = !!data.hasApiKey;
    apiConfig.chatModel = data.chatModel || 'deepseek-v4-flash';
    apiConfig.reasoningModel = data.reasoningModel || 'deepseek-v4-pro';
  } catch {
    loadError.value = '无法读取已保存的配置，请检查网络或服务状态。';
    toast.error('加载 API 配置失败');
  } finally {
    loading.value = false;
  }
};

const isValidEndpoint = (endpoint: string) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const testConnection = async () => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return;
  }

  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确，请输入以 http:// 或 https:// 开头的 URL');
    return;
  }

  if (!apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('请先填写 API Key');
    return;
  }

  testing.value = true;
  try {
    await testApiConnection({
      endpoint: apiConfig.endpoint,
      apiKey: apiConfig.apiKey || undefined,
      model: apiConfig.chatModel,
    });
    toast.success('连接测试成功');
  } catch (error: any) {
    toast.error(`连接失败：${error.message}`);
  } finally {
    testing.value = false;
  }
};

// 获取端点可用模型列表（避免手填模型名）
const loadModels = async () => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return;
  }
  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确');
    return;
  }
  if (!apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('请先填写 API Key');
    return;
  }

  loadingModels.value = true;
  try {
    const res = await fetchApiModels({
      endpoint: apiConfig.endpoint,
      apiKey: apiConfig.apiKey || undefined
    });
    const models = res.data?.models || [];
    modelOptions.value = models;
    // 未填模型时自动填充第一个可用模型，减少手填
    if (!apiConfig.chatModel && models.length) apiConfig.chatModel = models[0];
    if (!apiConfig.reasoningModel && models.length) apiConfig.reasoningModel = models[0];
    toast.success(`获取到 ${models.length} 个可用模型`);
  } catch (error: any) {
    modelOptions.value = [];
    toast.error(error?.message || '获取模型列表失败');
  } finally {
    loadingModels.value = false;
  }
};

const saveApiConfig = async (): Promise<boolean> => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return false;
  }

  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确，请输入以 http:// 或 https:// 开头的 URL');
    return false;
  }

  if (apiConfig.enabled && !apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('启用时必须填写 API Key');
    return false;
  }

  saving.value = true;
  try {
    await updateUserApiConfig({
      enabled: apiConfig.enabled,
      endpoint: apiConfig.endpoint,
      apiKey: apiConfig.apiKey || undefined,
      chatModel: apiConfig.chatModel,
      reasoningModel: apiConfig.reasoningModel,
    });

    toast.success('配置已保存');
    if (apiConfig.apiKey) {
      hasSavedApiKey.value = true;
      apiConfig.apiKey = '';
    }
    return true;
  } catch (error: any) {
    toast.error(`保存失败：${error.message}`);
    return false;
  } finally {
    saving.value = false;
  }
};

const disableConfig = async () => {
  const ok = await askConfirm({
    title: '禁用自定义 API',
    message: '禁用后将立即改用平台默认模型，已保存的端点和 API Key 会保留。确认继续吗？',
    confirmText: '确认禁用',
    danger: true,
    busy: true
  })
  if (!ok) return
  disabling.value = true;
  try {
    await disableUserApiConfig();
    apiConfig.enabled = false;
    toast.success('已禁用自定义 API，将使用平台默认配置');
    doneConfirm();
  } catch (error: any) {
    apiConfig.enabled = true;
    toast.error(`操作失败：${error.message}`);
    failConfirm();
  } finally {
    disabling.value = false;
  }
};

const handleEnabledChange = () => {
  const enabled = apiConfig.enabled
  if (!enabled) {
    /* 开关 UI 已翻到 false：先回滚为 true 保持「UI=服务端」一致，用户确认禁用后才由
       disableConfig 真正置 false —— 否则取消确认后开关/徽章/服务端三者失同步 */
    apiConfig.enabled = true
    void disableConfig();
    return;
  }

  if (!apiConfig.endpoint || !isValidEndpoint(apiConfig.endpoint) || (!hasSavedApiKey.value && !apiConfig.apiKey)) {
    apiConfig.enabled = false;
    toast.info('请先填写模型端点和 API Key，保存后再启用');
    return;
  }

  // 启用即保存，避免"界面显示已启用但服务端未生效"的不一致状态
  void saveApiConfig().then((saved) => {
    if (!saved) {
      apiConfig.enabled = false;
    }
  });
};

/* ==================== 我的 MCP 工具 ==================== */

/** 与后端 MCP_TOOL_ID_PATTERN 对齐 */
const MCP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const mcpTools = ref<UserMcpToolConfig[]>([]);
const mcpLoading = ref(false);
const mcpSaving = ref(false);
const mcpError = ref('');
const mcpFormOpen = ref(false);
const mcpEditingId = ref('');
const mcpFormHadKey = ref(false);
const mcpTestingId = ref('');
/** 每个 MCP server 的测试工具名（用于拼 serverId:toolName 寻址） */
const mcpToolName = reactive<Record<string, string>>({});
const mcpForm = reactive({
  id: '',
  name: '',
  transport: 'http' as 'http' | 'mcp',
  endpoint: '',
  apiKey: '',
  enabled: true,
});

const errorText = (error: any): string =>
  error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || '未知错误';

const loadMcpConfig = async () => {
  mcpLoading.value = true;
  mcpError.value = '';
  try {
    const res = await getUserMcpConfig();
    const data = res.data?.data ?? res.data ?? {};
    mcpTools.value = Array.isArray(data.tools) ? data.tools : [];
  } catch {
    mcpError.value = '无法读取 MCP 配置，请检查网络或服务状态。';
  } finally {
    mcpLoading.value = false;
  }
};

const openMcpCreate = () => {
  mcpEditingId.value = '';
  mcpFormHadKey.value = false;
  Object.assign(mcpForm, { id: '', name: '', transport: 'http', endpoint: '', apiKey: '', enabled: true });
  mcpFormOpen.value = true;
};

const openMcpEdit = (tool: UserMcpToolConfig) => {
  mcpEditingId.value = tool.id;
  mcpFormHadKey.value = Boolean(tool.apiKeyConfigured);
  Object.assign(mcpForm, {
    id: tool.id,
    name: tool.name || tool.id,
    transport: (tool.transport || 'http') as 'http' | 'mcp',
    endpoint: tool.endpoint || '',
    apiKey: '',
    enabled: tool.enabled !== false,
  });
  mcpFormOpen.value = true;
};

/** 新增或更新单个工具：读改写整表 tools（后端按 id 保留未回传的 apiKey） */
const saveMcpTool = async () => {
  const id = mcpForm.id.trim().toLowerCase();
  const name = mcpForm.name.trim();
  const endpoint = mcpForm.endpoint.trim();

  if (!id) return toast.warning('请填写工具 ID');
  if (!MCP_ID_PATTERN.test(id)) return toast.warning('工具 ID 仅允许字母数字与 . _ : -');
  if (!name) return toast.warning('请填写名称');
  if (!endpoint) return toast.warning('请填写 Endpoint');
  if (!isValidEndpoint(endpoint)) return toast.warning('Endpoint 格式不正确，请输入以 http:// 或 https:// 开头的 URL');

  // 编辑时 id 不可改，存在即为「更新」；新增时重复 id 才是冲突
  const isEditing = Boolean(mcpEditingId.value);
  const exists = mcpTools.value.some((t) => t.id.toLowerCase() === id);
  if (!isEditing && exists) {
    return toast.warning(`工具 ${id} 已存在`);
  }

  const next: UserMcpToolConfig = {
    id,
    name,
    description: '',
    type: mcpForm.transport === 'mcp' ? 'mcp' : 'remote',
    transport: mcpForm.transport,
    endpoint,
    enabled: mcpForm.enabled,
    ...(mcpForm.apiKey ? { apiKey: mcpForm.apiKey } : {}),
  };

  const tools = exists
    ? mcpTools.value.map((t) => (t.id.toLowerCase() === id ? { ...t, ...next } : t))
    : [...mcpTools.value, next];

  mcpSaving.value = true;
  try {
    await updateUserMcpConfig({ tools });
    await loadMcpConfig();
    mcpFormOpen.value = false;
    toast.success(exists ? 'MCP 工具已更新' : 'MCP 工具已新增');
  } catch (error: any) {
    toast.error(`保存失败：${errorText(error)}`);
  } finally {
    mcpSaving.value = false;
  }
};

const removeMcpTool = async (tool: UserMcpToolConfig) => {
  const ok = await askConfirm({
    title: '删除 MCP 工具',
    message: `确认删除「${tool.name}」（${tool.id}）？删除后对话将无法再调用它。`,
    confirmText: '删除',
    danger: true,
    busy: true
  });
  if (!ok) return;

  mcpSaving.value = true;
  try {
    const tools = mcpTools.value.filter((t) => t.id.toLowerCase() !== tool.id.toLowerCase());
    await updateUserMcpConfig({ tools });
    await loadMcpConfig();
    toast.success('MCP 工具已删除');
    doneConfirm();
  } catch (error: any) {
    toast.error(`删除失败：${errorText(error)}`);
    failConfirm();
  } finally {
    mcpSaving.value = false;
  }
};

/** 测试：HTTP 直接执行；MCP 需带工具名，以 id:toolName 寻址 */
const testMcpTool = async (tool: UserMcpToolConfig) => {
  let callId = tool.id;
  if (tool.transport === 'mcp') {
    const toolName = (mcpToolName[tool.id] || '').trim();
    if (!toolName) return toast.warning('请先填写该 MCP 服务的工具名（如 tavily_search）');
    callId = `${tool.id}:${toolName}`;
  }

  mcpTestingId.value = tool.id;
  try {
    const res = await executeMcpTool(callId, {});
    const data = res.data?.data ?? res.data;
    const preview = typeof data === 'string' ? data.slice(0, 80) : JSON.stringify(data).slice(0, 80);
    toast.success(`调用成功：${preview || '（空返回）'}`);
  } catch (error: any) {
    toast.error(`调用失败：${errorText(error)}`);
  } finally {
    mcpTestingId.value = '';
  }
};
</script>

<style scoped>
.user-settings-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

/* 状态条 */
.settings-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 14px;
  background: var(--surface, #fff);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
  flex-wrap: wrap;
}

.settings-status__left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.settings-status__left strong {
  display: block;
  font-size: 14px;
  color: var(--ink, #172033);
}

.settings-status__left p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--faint, #67758f);
}

/* 两栏：表单 + 说明 */
.settings-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 1100px) {
  .settings-cols {
    grid-template-columns: 1fr;
  }
}

.settings-side {
  display: grid;
  gap: 16px;
}

.help-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}

.help-list li {
  display: grid;
  gap: 3px;
}

.help-list strong {
  font-size: 13.5px;
  color: var(--ink, #172033);
}

.help-list span {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  line-height: 1.6;
}

.help-tip {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--canvas, #f3f6fb);
  border: 1px dashed var(--line, #e3e9f4);
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  line-height: 1.6;
}

.api-form {
  display: grid;
  gap: 16px;
  max-width: 640px;
}

/* 移动端表单密度：字段间距 16 → 12（同一张卡内 8~12px 是规范区间）。
   输入框/按钮的**尺寸不动**——见 uc.css 里 16px 字号与 ≥40px 高度的注释，那是 iOS/规范下限。 */
@media (max-width: 1100px) {
  .api-form { gap: 12px; }
  .api-form__grid { gap: 10px; }
  .action-buttons { gap: 8px; margin-top: 4px; }
}

.api-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 640px) {
  .api-form__grid {
    grid-template-columns: 1fr;
  }
}

.action-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.uc-field__pwd {
  position: relative;
}

.uc-field__pwd .uc-field__input {
  padding-right: 56px;
}

.uc-field__eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--faint, #67758f);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
}

.uc-field__eye:hover {
  background: var(--canvas, #f3f6fb);
  color: var(--muted, #5b6577);
}

.uc-switch__label {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted, #5b6577);
}

.uc-switch--off .uc-switch__label {
  color: var(--faint, #67758f);
}

.model-options-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--faint, #67758f);
}

.model-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep, #1f57cc);
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 11.5px;
}

.model-more {
  color: var(--muted, #5b6577);
}

/* ==================== 我的 MCP 工具 ==================== */
.mcp-empty {
  margin: 0;
  padding: 18px;
  border: 1px dashed var(--line, #e3e9f4);
  border-radius: 12px;
  background: var(--canvas, #f3f6fb);
  font-size: 13px;
  color: var(--muted, #5b6577);
  text-align: center;
}

.mcp-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.mcp-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 12px;
  background: var(--surface, #fff);
}

.mcp-item__kind {
  display: inline-grid;
  place-items: center;
  min-width: 46px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.03em;
  background: var(--canvas, #f3f6fb);
  color: var(--faint, #67758f);
}

.mcp-item__kind.is-mcp {
  background: rgba(52, 120, 246, 0.1);
  color: var(--blue-deep, #1f57cc);
}

.mcp-item__main {
  flex: 1 1 200px;
  display: grid;
  gap: 2px;
  min-width: 0;
}

.mcp-item__main strong {
  font-size: 13.5px;
  color: var(--ink, #172033);
}

.mcp-item__sub {
  font-size: 12px;
  color: var(--faint, #67758f);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
}

.mcp-item__toolname {
  flex: 0 1 180px;
  min-width: 140px;
}

.mcp-item__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.mcp-form {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--line, #e3e9f4);
  display: grid;
  gap: 14px;
  max-width: 640px;
}

.mcp-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--canvas, #f3f6fb);
  border: 1px dashed var(--line, #e3e9f4);
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  line-height: 1.7;
}

.mcp-hint code {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 11.5px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep, #1f57cc);
  padding: 1px 5px;
  border-radius: 5px;
}
</style>
