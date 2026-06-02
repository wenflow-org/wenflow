<template>
  <el-drawer v-model="localVisible" :title="`Skill 节点详情 · ${currentSkill?.skillId || skillId || ''}`" size="min(68%, 980px)" destroy-on-close>
    <div class="skill-workbench" v-loading="loading">
      <template v-if="currentSkill">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="中文名称">{{ getSkillDisplayName(currentSkill) }}</el-descriptions-item>
          <el-descriptions-item label="调用名">{{ currentSkill.skillId }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag v-if="currentSkill.status" :type="getStatusTagType(currentSkill.status)" size="small">{{ getStatusLabel(currentSkill.status) }}</el-tag>
            <span v-else>-</span>
          </el-descriptions-item>
          <el-descriptions-item label="配置模式">
            <el-tag :type="currentSkill.enabled ? 'success' : 'info'" size="small">{{ currentSkill.enabled ? '独立配置' : '继承' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="模型层级">{{ currentSkill.tier || '-' }}</el-descriptions-item>
          <el-descriptions-item label="模型">{{ currentSkill.model || '平台默认' }}</el-descriptions-item>
          <el-descriptions-item label="说明" :span="2">{{ getSkillHint(currentSkill.skillId) || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="chip-section">
          <div class="chip-row">
            <span class="chip-label">thinking</span>
            <el-tag size="small" effect="plain" :type="thinkingTagType(currentSkill.thinkingMode)">{{ formatThinkingMode(currentSkill.thinkingMode) }}</el-tag>
            <el-tag size="small" effect="plain" :type="effortTagType(currentSkill.reasoningEffort)">{{ formatReasoningEffort(currentSkill.reasoningEffort) }}</el-tag>
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

              <div v-if="effectivePrompt" class="prompt-active-card">
                <div class="prompt-summary-card">
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">当前版本</span><strong>{{ effectivePrompt.version !== null && effectivePrompt.version !== undefined ? `v${effectivePrompt.version}` : '-' }}</strong></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">状态</span><el-tag size="small" :type="getPromptStatusTagType(effectivePrompt.status)">{{ getPromptStatusLabel(effectivePrompt.status) }}</el-tag></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">名称</span><span>{{ effectivePrompt.name || '-' }}</span></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">来源</span><el-tag size="small" :type="promptSourceTagType(effectivePromptSource)">{{ promptSourceLabel(effectivePromptSource) }}</el-tag></div>
                  <div v-if="promptDriftWarning" class="prompt-summary-card__row"><span class="prompt-summary-card__label">代码同步</span><el-tag size="small" type="danger">DB ACTIVE 与代码默认 Prompt 不一致</el-tag></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">运行参数</span><span>T={{ effectivePrompt.temperature ?? '--' }} | Max={{ effectivePrompt.maxTokens ?? '--' }}</span></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">模型</span><span>{{ effectivePrompt.model || '--' }}</span></div>
                  <div class="prompt-summary-card__row"><span class="prompt-summary-card__label">发布时间</span><span>{{ formatDateTime(effectivePrompt.publishedAt || effectivePrompt.updatedAt || effectivePrompt.createdAt) }}</span></div>
                </div>

                <div class="prompt-text-card">
                  <div class="prompt-text-card__header">
                    <h4>System Prompt</h4>
                    <el-button v-if="promptPreviewText" type="primary" link @click="promptExpanded = !promptExpanded">{{ promptExpanded ? '收起全文' : '展开全文' }}</el-button>
                  </div>
                  <pre class="sample-json prompt-text-card__content">{{ visiblePromptText }}</pre>
                </div>
              </div>

              <el-empty v-else description="当前没有可展示的 Prompt。" />

              <div class="prompt-versions-card">
                <div class="prompt-versions-card__header"><h4>最近版本</h4><span class="prompt-versions-card__meta">{{ promptVersions.length }} 条</span></div>
                <div v-if="promptVersions.length" class="prompt-versions-table">
                  <el-table :data="promptVersions" size="small" border>
                    <el-table-column prop="version" label="版本" width="80" />
                    <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
                    <el-table-column label="参数" min-width="120"><template #default="{ row }"><span class="params-inline">T={{ row.temperature ?? '--' }} | {{ row.maxTokens ?? '--' }}</span></template></el-table-column>
                    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag size="small" effect="plain" :type="getPromptStatusTagType(row.status)">{{ getPromptStatusLabel(row.status) }}</el-tag></template></el-table-column>
                    <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
                    <el-table-column label="更新时间" min-width="140"><template #default="{ row }">{{ formatDateTime(row.updatedAt || row.createdAt) }}</template></el-table-column>
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

              <div class="prompt-versions-card">
                <div class="prompt-versions-card__header"><h4>Preview</h4><el-button @click="runSkillPreview" :loading="previewLoading">运行预览</el-button></div>
                <div class="contract-grid">
                  <section class="contract-card"><span class="chip-label">Sample Input</span><el-input v-model="skillPreviewInputText" type="textarea" :rows="16" class="preview-textarea" /></section>
                  <section class="contract-card"><span class="chip-label">Sample Output</span><pre v-if="skillPreviewOutput !== null" class="sample-json">{{ prettyJson(skillPreviewOutput) }}</pre><el-empty v-else description="点击“运行预览”查看输出" /></section>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="模型运行时">
            <div class="skill-config-form">
              <el-alert v-if="getSkillHint(editForm.skillId)" :title="getSkillHint(editForm.skillId)" type="info" :closable="false" show-icon class="skill-config-form__notice" />
              <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="110px">
                <el-form-item label="Skill ID"><el-input v-model="editForm.skillId" disabled /></el-form-item>
                <el-form-item label="中文名称"><el-input v-model="editForm.displayName" disabled placeholder="无" /></el-form-item>
                <el-form-item label="独立配置"><el-switch v-model="editForm.enabled" /><div class="field-hint">关闭后将继承当前调用 Agent 的配置；若无 Agent 上下文，则回落平台默认</div></el-form-item>
                <el-form-item label="模型层级"><el-select v-model="editForm.tier" placeholder="选择层级" style="width: 100%" :disabled="!editForm.enabled"><el-option label="chat" value="chat" /><el-option label="reasoning" value="reasoning" /></el-select></el-form-item>
                <el-form-item label="模型"><el-input v-model="editForm.model" :disabled="!editForm.enabled" placeholder="留空继承 Agent / 平台默认" /></el-form-item>
                <el-form-item label="思考模式"><el-select v-model="editForm.thinkingMode" placeholder="选择思考模式" style="width: 100%" :disabled="!editForm.enabled"><el-option label="跟随继承值 / 模型默认" value="default" /><el-option label="开启" value="enabled" /><el-option label="关闭" value="disabled" /></el-select></el-form-item>
                <el-form-item label="思考强度"><el-select v-model="editForm.reasoningEffort" placeholder="选择思考强度" style="width: 100%" :disabled="!editForm.enabled || editForm.thinkingMode === 'disabled'"><el-option label="跟随继承值 / 模型默认" value="default" /><el-option label="high" value="high" /><el-option label="max" value="max" /></el-select></el-form-item>
                <el-form-item label="温度"><el-slider v-model="editForm.temperature" :min="0" :max="1" :step="0.1" show-input :disabled="!editForm.enabled" /></el-form-item>
                <el-form-item label="Max Tokens"><el-input-number v-model="editForm.maxTokens" :min="100" :max="20000" :disabled="!editForm.enabled" /></el-form-item>
                <el-form-item label="请求超时(ms)"><el-input-number v-model="editForm.requestTimeoutMs" :min="10000" :max="600000" :step="10000" :disabled="!editForm.enabled" /></el-form-item>
              </el-form>
              <div class="skill-config-dialog__footer"><el-button type="warning" :disabled="!currentSkill.enabled" @click="deleteConfig(currentSkill)">恢复默认</el-button><el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button></div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <el-dialog v-model="promptEditDialogVisible" :title="`${currentPromptDraftId ? '编辑' : '创建'} Skill Prompt · ${currentPromptSkillId}`" width="720px" destroy-on-close>
      <el-form :model="promptEditForm" label-width="110px" v-loading="promptDetailLoading">
        <el-form-item label="名称"><el-input v-model="promptEditForm.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="promptEditForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="模型"><el-input v-model="promptEditForm.model" /></el-form-item>
        <el-form-item label="温度"><el-slider v-model="promptEditForm.temperature" :min="0" :max="1" :step="0.1" show-input /></el-form-item>
        <el-form-item label="Max Tokens"><el-input-number v-model="promptEditForm.maxTokens" :min="100" :max="40000" /></el-form-item>
        <el-form-item label="System Prompt"><el-input v-model="promptEditForm.systemPrompt" type="textarea" :rows="18" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="promptEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="promptSaving" @click="savePromptDraft">{{ currentPromptDraftId ? '保存修改' : '创建草稿' }}</el-button>
        <el-button v-if="!currentPromptDraftId" type="success" :loading="promptSaving" @click="createAndPublishPrompt">创建并发布</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { adminAgentPromptsApi, adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface SkillNodeConfig {
  skillId: string
  displayName?: string
  status?: 'working' | 'placeholder' | 'simplified' | 'mock'
  lastCalledAt?: string | null
  tier: string
  model?: string
  thinkingMode?: 'default' | 'enabled' | 'disabled'
  reasoningEffort?: 'default' | 'high' | 'max'
  temperature?: number
  maxTokens?: number
  requestTimeoutMs?: number | null
  enabled: boolean
}

const props = defineProps<{ visible: boolean; skillId: string }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; changed: [] }>()

const localVisible = computed({ get: () => props.visible, set: (value: boolean) => emit('update:visible', value) })

const loading = ref(false)
const currentSkill = ref<SkillNodeConfig | null>(null)
const saving = ref(false)
const promptDrawerLoading = ref(false)
const currentPromptSkillId = ref('')
const promptVersions = ref<any[]>([])
const effectivePrompt = ref<any | null>(null)
const effectivePromptSource = ref<'db-active' | 'code-fallback' | 'generated-default' | ''>('')
const promptDriftWarning = ref(false)
const promptExpanded = ref(false)
const promptEditDialogVisible = ref(false)
const promptSaving = ref(false)
const currentPromptDraftId = ref('')
const publishingId = ref<string | null>(null)
const promptDetailLoading = ref(false)
const previewLoading = ref(false)
const skillPreviewInputText = ref('')
const skillPreviewOutput = ref<any>(null)
const editFormRef = ref<FormInstance>()

const promptEditForm = ref<any>({ name: '', description: '', systemPrompt: '', temperature: 0.2, maxTokens: 32000, model: 'deepseek-v4-pro' })
const editForm = ref<SkillNodeConfig>({ skillId: '', displayName: '', tier: 'chat', thinkingMode: 'default', reasoningEffort: 'default', temperature: 0.7, maxTokens: 2000, requestTimeoutMs: null, enabled: false })
const editRules = { temperature: [{ required: true, message: '请设置温度', trigger: 'change' }], maxTokens: [{ required: true, message: '请输入最大 Token 数', trigger: 'blur' }] }

const SKILL_HINTS: Record<string, string> = { 'path-scene-framing': 'Path 冷启动输入清洗层：统一收敛 Goal 输出为标准主输入（normalizedInput），再交给 path-agent 主生成。', 'stage-designer': 'Path 阶段任务设计层：围绕单个 milestone 生成 subtasks，并补轻量任务标签，不直接写 Learn 教案。', 'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 阶段回合模拟：只生成学习者在目标对话里的短回复与主观状态。', 'virtual-learner-path-evaluator': '虚拟学习者 Path 阶段评估：判断路径是否贴合故事处境，并给出可见反应。', 'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 阶段回合模拟：只生成学习者对老师本轮教学的短回复与主观状态。' }
const SKILL_CN_NAMES: Record<string, string> = {
  'text-structure-analyzer': '文本结构分析器', 'retrieval': '内容检索器', 'web-extractor': '网页内容提取器', 'image-analyzer': '图片分析器', 'memory-search': '学习记忆搜索器', 'smart-search': '智能搜索器', 'label-generator': '动态标签生成器', 'path-scene-framing': '路径场景构图', 'stage-designer': '阶段任务设计器', 'adaptive-guidance-copy': '动态引导文案生成器', 'goal-profile-inference': '目标阶段画像推断器', 'learning-pattern-distiller': '学习模式蒸馏器', 'session-knowledge-distiller': '课堂知识蒸馏器', 'dialogue-concept-extractor': '对话概念抽取器', 'virtual-learner-persona-designer': '虚拟学习者身份设计器', 'virtual-learner-scenario-designer': '虚拟学习者故事设计器', 'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 对话模拟器', 'virtual-learner-path-evaluator': '虚拟学习者路径评估器', 'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 回合模拟器', 'peer-reinforcement': '同伴强化', 'goal-type-identifier': '目标类型识别器', 'batch-anderson-labeler': '批量安德森标注器', 'time-estimator': '时间估算器', 'quiz-generation': '测验生成器', 'pdf-parser': 'PDF 解析器', 'exercise-generator': '练习生成器', 'error-pattern': '错误模式分析器', 'content-generation': '内容生成器', 'code-explainer': '代码解释器', 'answer-generation': '答案生成器',
}

const toSkillPromptAgentId = (skillId: string) => `skill:${skillId}`
const getSkillHint = (skillId?: string) => (skillId ? SKILL_HINTS[skillId] || '' : '')
const getSkillDisplayName = (row: SkillNodeConfig) => SKILL_CN_NAMES[row.skillId] || row.displayName || row.skillId
const formatThinkingMode = (thinkingMode?: 'default' | 'enabled' | 'disabled') => thinkingMode === 'enabled' ? '开启' : thinkingMode === 'disabled' ? '关闭' : '继承/默认'
const formatReasoningEffort = (reasoningEffort?: 'default' | 'high' | 'max') => reasoningEffort === 'high' ? 'high' : reasoningEffort === 'max' ? 'max' : '继承/默认'
const thinkingTagType = (thinkingMode?: 'default' | 'enabled' | 'disabled') => thinkingMode === 'enabled' ? 'warning' : thinkingMode === 'disabled' ? 'success' : 'info'
const effortTagType = (reasoningEffort?: 'default' | 'high' | 'max') => reasoningEffort === 'max' ? 'danger' : reasoningEffort === 'high' ? 'warning' : 'info'
const formatTimeout = (timeoutMs?: number | null) => !timeoutMs || Number.isNaN(Number(timeoutMs)) ? '继承' : `${Math.round(Number(timeoutMs) / 1000)}s`
const getStatusTagType = (status?: SkillNodeConfig['status']) => status === 'working' ? 'success' : status === 'placeholder' ? 'danger' : status === 'simplified' ? 'warning' : status === 'mock' ? 'info' : ''
const getStatusLabel = (status?: SkillNodeConfig['status']) => status === 'working' ? '正常' : status === 'placeholder' ? '占位' : status === 'simplified' ? '简化' : status === 'mock' ? '模拟' : ''
const getPromptStatusLabel = (status?: string | null) => !status ? '未知' : ({ ACTIVE: '已生效', BUILT_IN: '代码内置', FALLBACK: '代码内置', ARCHIVED: '已归档', DRAFT: '草稿', PUBLISHED: '已发布', STAGING: '预发布' } as Record<string, string>)[status.toUpperCase()] || '未知'
const getPromptStatusTagType = (status?: string | null) => !status ? 'info' : ['ACTIVE', 'PUBLISHED'].includes(status.toUpperCase()) ? 'success' : status.toUpperCase() === 'STAGING' ? 'warning' : 'info'
const promptSourceLabel = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => source === 'db-active' ? 'DB Active' : source === 'code-fallback' ? 'Code Fallback' : source === 'generated-default' ? 'Generated Default' : 'Unknown'
const promptSourceTagType = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => source === 'db-active' ? 'success' : source === 'generated-default' ? 'warning' : 'info'
const formatDateTime = (value: string | null | undefined) => !value ? '-' : Number.isNaN(new Date(value).getTime()) ? '-' : new Date(value).toLocaleString('zh-CN')
const prettyJson = (value: any) => value === null || value === undefined ? '-' : JSON.stringify(value, null, 2)
const promptPreviewText = computed(() => effectivePrompt.value?.systemPrompt?.trim() || '')
const visiblePromptText = computed(() => { const text = promptPreviewText.value; if (!text) return '暂无 Prompt 内容'; if (promptExpanded.value) return text; const lines = text.split('\n'); return lines.length <= 8 ? text : `${lines.slice(0, 8).join('\n')}\n\n...`; })
const toEditablePayload = (config: SkillNodeConfig) => ({ tier: config.tier, model: config.model, thinkingMode: config.thinkingMode || 'default', reasoningEffort: config.thinkingMode === 'disabled' ? 'default' : (config.reasoningEffort || 'default'), temperature: config.temperature, maxTokens: config.maxTokens, requestTimeoutMs: config.enabled ? config.requestTimeoutMs : null, enabled: config.enabled })

const loadPromptManager = async () => {
  if (!currentPromptSkillId.value) return
  promptDrawerLoading.value = true
  try {
    const [versionsRes, activeRes, effectiveRes] = await Promise.allSettled([
      adminAgentPromptsApi.getPromptVersions({ agentId: toSkillPromptAgentId(currentPromptSkillId.value) }),
      adminAgentPromptsApi.getActivePrompt(toSkillPromptAgentId(currentPromptSkillId.value)),
      adminSkillsApi.getEffectiveSkillPrompt(currentPromptSkillId.value),
    ])
    promptVersions.value = versionsRes.status === 'fulfilled' ? (versionsRes.value.data?.data?.list || []) : []
    const activePrompt = activeRes.status === 'fulfilled' ? activeRes.value.data?.data || null : null
    effectivePrompt.value = effectiveRes.status === 'fulfilled' ? effectiveRes.value.data?.data?.prompt || activePrompt : activePrompt
    effectivePromptSource.value = effectiveRes.status === 'fulfilled' ? (effectiveRes.value.data?.data?.source || '') : (activePrompt ? 'db-active' : '')
    promptDriftWarning.value = !!(effectiveRes.status === 'fulfilled' && effectiveRes.value.data?.data?.promptDrift)
  } catch {
    toast.error('加载 Skill Prompt 失败')
  } finally {
    promptDrawerLoading.value = false
  }
}

const loadSkill = async () => {
  if (!props.visible || !props.skillId) return
  loading.value = true
  try {
    const res = await adminSkillsApi.getSkillModelConfig(props.skillId)
    const skill = res.data?.data || null
    currentSkill.value = skill
    currentPromptSkillId.value = props.skillId
    if (skill) {
      editForm.value = { ...skill, displayName: skill.displayName || '', thinkingMode: skill.thinkingMode || 'default', reasoningEffort: skill.reasoningEffort || 'default' }
      skillPreviewInputText.value = ''
      skillPreviewOutput.value = null
      effectivePrompt.value = null
      effectivePromptSource.value = ''
      promptDriftWarning.value = false
      promptExpanded.value = false
      await loadPromptManager()
    }
  } catch {
    toast.error('加载 Skill 节点失败')
  } finally {
    loading.value = false
  }
}

const saveConfig = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    await adminSkillsApi.updateSkillModelConfig(editForm.value.skillId, toEditablePayload(editForm.value))
    toast.success('Skill 配置已更新')
    emit('changed')
    await loadSkill()
  } catch {
    toast.error('保存失败')
  } finally {
    saving.value = false
  }
}

const deleteConfig = async (row: SkillNodeConfig) => {
  try {
    await ElMessageBox.confirm(`确定要恢复 ${row.displayName || row.skillId} 的默认模型配置吗？此操作不可撤销。`, '确认恢复默认', { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  try {
    await adminSkillsApi.deleteSkillModelConfig(row.skillId)
    toast.success('配置已恢复默认')
    emit('changed')
    await loadSkill()
  } catch { toast.error('删除失败') }
}

const openCreatePromptDialog = () => { currentPromptDraftId.value = ''; const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1; promptEditForm.value = { name: `v${nextVersion}`, description: '', systemPrompt: effectivePrompt.value?.systemPrompt || '', temperature: 0.2, maxTokens: 32000, model: 'deepseek-v4-pro' }; promptEditDialogVisible.value = true }
const openForkFromActive = () => { if (!effectivePrompt.value) return; currentPromptDraftId.value = ''; const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1; promptEditForm.value = { name: `v${nextVersion}-fork`, description: `基于 ${effectivePrompt.value.version ? `v${effectivePrompt.value.version}` : '当前版本'} 修改`, systemPrompt: effectivePrompt.value.systemPrompt || '', temperature: effectivePrompt.value.temperature ?? 0.2, maxTokens: effectivePrompt.value.maxTokens ?? 32000, model: effectivePrompt.value.model || 'deepseek-v4-pro' }; promptEditDialogVisible.value = true }
const editPromptVersion = async (version: any) => { promptDetailLoading.value = true; try { const res = await adminAgentPromptsApi.getPromptDetail(version.id); const detail = res.data?.data; if ((version.status || '').toUpperCase() === 'DRAFT') { currentPromptDraftId.value = version.id; promptEditForm.value = { name: detail?.name || '', description: detail?.description || '', systemPrompt: detail?.systemPrompt || '', temperature: detail?.temperature ?? 0.2, maxTokens: detail?.maxTokens ?? 32000, model: detail?.model || 'deepseek-v4-pro' }; } else { currentPromptDraftId.value = ''; const nextVersion = (Number(promptVersions.value[0]?.version) || 0) + 1; promptEditForm.value = { name: `v${nextVersion}-修改`, description: `基于 v${version.version || '?'} 修改`, systemPrompt: detail?.systemPrompt || '', temperature: detail?.temperature ?? 0.2, maxTokens: detail?.maxTokens ?? 32000, model: detail?.model || 'deepseek-v4-pro' }; } promptEditDialogVisible.value = true } catch { toast.error('加载 Prompt 详情失败') } finally { promptDetailLoading.value = false } }
const savePromptDraft = async () => { if (!currentPromptSkillId.value || !promptEditForm.value.systemPrompt?.trim()) return toast.error('请填写 Prompt 内容'); promptSaving.value = true; try { if (currentPromptDraftId.value) await adminAgentPromptsApi.updatePrompt(currentPromptDraftId.value, promptEditForm.value); else await adminAgentPromptsApi.createPrompt({ agentId: toSkillPromptAgentId(currentPromptSkillId.value), name: promptEditForm.value.name, description: promptEditForm.value.description, systemPrompt: promptEditForm.value.systemPrompt, temperature: promptEditForm.value.temperature, maxTokens: promptEditForm.value.maxTokens, model: promptEditForm.value.model }); toast.success('Skill Prompt 草稿已保存'); promptEditDialogVisible.value = false; await loadPromptManager() } catch { toast.error('保存 Skill Prompt 失败') } finally { promptSaving.value = false } }
const createAndPublishPrompt = async () => { if (!currentPromptSkillId.value || !promptEditForm.value.systemPrompt?.trim()) return toast.error('请填写 Prompt 内容'); promptSaving.value = true; try { const createRes = await adminAgentPromptsApi.createPrompt({ agentId: toSkillPromptAgentId(currentPromptSkillId.value), name: promptEditForm.value.name, description: promptEditForm.value.description, systemPrompt: promptEditForm.value.systemPrompt, temperature: promptEditForm.value.temperature, maxTokens: promptEditForm.value.maxTokens, model: promptEditForm.value.model }); const newPromptId = createRes.data?.id || createRes.data?.data?.id; if (!newPromptId) return toast.error('创建失败，未获取到 Prompt ID'); await adminAgentPromptsApi.publishPrompt(newPromptId); toast.success('Skill Prompt 已创建并发布'); promptEditDialogVisible.value = false; await loadPromptManager() } catch { toast.error('创建或发布 Skill Prompt 失败') } finally { promptSaving.value = false } }
const deletePromptDraft = async (id: string) => { try { await ElMessageBox.confirm('确定删除此版本？此操作不可恢复。', '删除确认', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }); await adminAgentPromptsApi.deletePrompt(id); toast.success('Skill Prompt 草稿已删除'); await loadPromptManager() } catch (error: any) { if (error !== 'cancel') toast.error('删除 Skill Prompt 失败') } }
const publishPrompt = async (id: string) => { publishingId.value = id; try { await adminAgentPromptsApi.publishPrompt(id); toast.success('Skill Prompt 已发布'); await loadPromptManager() } catch { toast.error('发布 Skill Prompt 失败') } finally { publishingId.value = null } }
const runSkillPreview = async () => { if (!currentPromptSkillId.value || !skillPreviewInputText.value.trim()) return; let parsedInput: any; try { parsedInput = JSON.parse(skillPreviewInputText.value) } catch { return toast.error('Sample Input 不是合法 JSON') } previewLoading.value = true; try { const res = await adminSkillsApi.testSkill(currentPromptSkillId.value, parsedInput); skillPreviewOutput.value = res.data?.data?.output ?? null } catch (error: any) { toast.error(error?.response?.data?.error || 'Skill 预览失败') } finally { previewLoading.value = false } }

watch(() => props.visible, (visible) => { if (visible) loadSkill() })
watch(() => props.skillId, (value) => { if (value && props.visible) loadSkill() })
watch(() => editForm.value.thinkingMode, (mode) => { if (mode === 'disabled') editForm.value.reasoningEffort = 'default' })
</script>

<style scoped>
.skill-workbench { display: grid; gap: 16px; min-height: 240px; padding-right: 4px; min-width: 0; }
.skill-workbench__tabs { min-width: 0; }
.skill-workbench :deep(.el-tabs__content) { padding-top: 0.25rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #2d6df2; font-size: 12px; font-weight: 700; }
.skill-masthead { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr); gap: 18px; padding: 22px 24px; border-radius: 28px; border: 1px solid rgba(196, 210, 236, 0.95); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.12), transparent 32%), linear-gradient(180deg, rgba(255,255,255,0.99), rgba(243,247,255,0.96)); box-shadow: 0 18px 42px rgba(42,72,128,0.1); }
.skill-masthead__title-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.skill-masthead__title-row h3 { margin: 0; font-size: 1.65rem; line-height: 1.2; color: #22344d; letter-spacing: -0.03em; }
.skill-masthead__subtitle { margin: 10px 0 0; color: #62758f; line-height: 1.7; max-width: 760px; }
.skill-masthead__meta { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 16px; color: #7085a6; font-size: 0.875rem; }
.skill-masthead__status { display: grid; gap: 12px; }
.skill-signal-card, .skill-overview-card, .skill-panel, .skill-kv-item, .skill-strategy-card { border: 1px solid rgba(205, 216, 238, 0.86); background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,255,0.95)); box-shadow: 0 12px 28px rgba(42,72,128,0.06); }
.skill-signal-card { border-radius: 22px; padding: 16px 18px; display: grid; gap: 10px; }
.skill-signal-card__label, .skill-overview-card__label, .skill-kv-item__label, .skill-strategy-card__label, .chip-label { color: #7b8ba3; font-size: 0.78rem; font-weight: 700; }
.skill-signal-card strong, .skill-overview-card strong, .skill-kv-item__value, .skill-strategy-card strong { color: #22344d; font-size: 1rem; line-height: 1.35; }
.skill-signal-card p, .skill-overview-card p, .skill-panel__header p, .skill-strategy-card p { margin: 0; color: #7085a6; font-size: 0.875rem; line-height: 1.6; }
.skill-overview-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.skill-overview-card { border-radius: 20px; padding: 16px 18px; display: grid; gap: 8px; }
.skill-layout-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr); gap: 16px; }
.skill-layout-grid__main, .skill-layout-grid__aside { display: grid; gap: 16px; align-content: start; }
.skill-panel { border-radius: 22px; padding: 18px 20px; }
.skill-panel--aside { position: sticky; top: 0; }
.skill-panel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.skill-panel__header h4 { margin: 0; color: #22344d; font-size: 1rem; }
.skill-kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.skill-kv-item { display: grid; gap: 6px; min-width: 0; padding: 14px 16px; border-radius: 16px; }
.skill-strategy-list { display: grid; gap: 12px; }
.skill-strategy-card { border-radius: 18px; padding: 14px 16px; display: grid; gap: 8px; }
.skill-prompt-drawer { padding: 1rem; display: grid; gap: 1rem; width: 100%; min-width: 0; box-sizing: border-box; }
.prompt-actions { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.prompt-summary-card, .prompt-text-card, .prompt-versions-card { border: 1px solid var(--border-light, var(--border-default)); border-radius: 14px; background: rgba(255, 255, 255, 0.72); padding: 0.9rem; width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; }
.prompt-summary-card { display: grid; gap: 0.7rem; }
.prompt-summary-card__row, .prompt-text-card__header, .prompt-versions-card__header { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.prompt-summary-card__label, .prompt-versions-card__meta, .params-inline { color: var(--text-secondary); font-size: 0.875rem; }
.prompt-text-card__header h4, .prompt-versions-card__header h4 { margin: 0; color: var(--text-primary); }
.sample-json { font-family: monospace; font-size: 0.75rem; background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: var(--radius-md); overflow: auto; max-height: 300px; }
.prompt-text-card__content { margin-top: 0.75rem; max-width: 100%; overflow-x: auto; }
.prompt-versions-table { margin-top: 0.75rem; max-width: 100%; overflow-x: auto; }
.contract-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; min-width: 0; }
.contract-card { padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--glass-bg-light); display: grid; gap: 0.75rem; min-width: 0; }
.preview-textarea :deep(.el-textarea__inner) { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.875rem; border-radius: 16px; background: rgba(52, 120, 246, 0.03); border-color: rgba(52, 120, 246, 0.08); }
.skill-config-form { display: grid; gap: 4px; }
.skill-config-form__notice { margin-bottom: 0.25rem; }
.skill-config-dialog__footer { display: flex; justify-content: flex-end; gap: 10px; }
.field-hint { margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
@media (max-width: 1100px) { .contract-grid, .skill-overview-strip, .skill-layout-grid, .skill-kv-grid, .skill-masthead { grid-template-columns: 1fr; } .skill-panel--aside { position: static; } }
</style>
