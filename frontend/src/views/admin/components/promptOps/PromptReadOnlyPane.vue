<template>
  <div class="prompt-readonly" v-loading="loading">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>Prompt 已启用 File-as-Truth 只读模式</template>
      正式内容只能修改 <code>prompts/skill.*.md</code>，经 Git 审核和部署同步后生效。此处用于查看、比较和复制。
    </el-alert>

    <div class="prompt-readonly__toolbar">
      <div class="prompt-readonly__facts">
        <span>DB ACTIVE v{{ compileInfo?.promptVersion ?? '-' }}</span>
        <span>源 Hash <code>{{ shortHash(compileInfo?.sourceHash) }}</code></span>
        <span>编译状态 {{ compileInfo?.status || '-' }}</span>
      </div>
      <el-button :icon="Refresh" @click="load" :loading="loading">刷新</el-button>
    </div>

    <div class="prompt-readonly__grid">
      <section class="prompt-readonly__panel">
        <header>
          <div>
            <strong>DB ACTIVE 源内容</strong>
            <span>{{ compileInfo?.source?.length || 0 }} 字符</span>
          </div>
          <el-button text @click="copy(compileInfo?.source || '')">复制</el-button>
        </header>
        <pre>{{ compileInfo?.source || '暂无内容' }}</pre>
      </section>

      <section class="prompt-readonly__panel prompt-readonly__panel--compiled">
        <header>
          <div>
            <strong>当前编译产物</strong>
            <span>{{ compileInfo?.compiled?.length || 0 }} 字符</span>
          </div>
          <el-button text @click="copy(compileInfo?.compiled || '')">复制</el-button>
        </header>
        <pre>{{ compileInfo?.compiled || '暂无编译产物' }}</pre>
      </section>
    </div>

    <section v-if="effectivePrompt" class="prompt-readonly__runtime">
      <div>
        <strong>运行时解析结果</strong>
        <span>{{ effectivePrompt.prompt?._usedCompiled ? '使用编译产物' : '使用源内容' }}</span>
      </div>
      <span>版本 v{{ effectivePrompt.prompt?.version ?? '-' }}</span>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { adminPromptOpsApi, adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface PromptCompileInfo {
  promptVersion?: number | string
  sourceHash?: string
  status?: string
  source?: string
  compiled?: string
  [key: string]: unknown
}

interface EffectivePromptInfo {
  prompt?: { _usedCompiled?: boolean; version?: number | string; [key: string]: unknown }
  [key: string]: unknown
}

const props = defineProps<{ agentId: string }>()
const loading = ref(false)
const compileInfo = ref<PromptCompileInfo | null>(null)
const effectivePrompt = ref<EffectivePromptInfo | null>(null)

const shortHash = (value?: string | null) => value ? value.slice(0, 12) : '-'

async function load() {
  if (!props.agentId) return
  loading.value = true
  try {
    const skillId = props.agentId.replace(/^skill:/, '')
    const [compileResponse, effectiveResponse] = await Promise.all([
      adminPromptOpsApi.getPromptCompileInfo(props.agentId),
      adminSkillsApi.getEffectiveSkillPrompt(skillId)
    ])
    compileInfo.value = compileResponse.data?.data || null
    effectivePrompt.value = effectiveResponse.data?.data || null
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || '加载 Prompt 信息失败')
  } finally {
    loading.value = false
  }
}

async function copy(content: string) {
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    toast.success('已复制')
  } catch {
    toast.error('复制失败：剪贴板不可用（需 HTTPS 或授权）')
  }
}

watch(() => props.agentId, load)
onMounted(load)
</script>

<style scoped>
.prompt-readonly {
  display: grid;
  gap: 16px;
}

.prompt-readonly__toolbar,
.prompt-readonly__runtime {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.prompt-readonly__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  color: #607189;
  font-size: 12px;
}

.prompt-readonly__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.prompt-readonly__panel {
  min-width: 0;
  border: 1px solid rgba(211, 221, 237, 0.94);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(250, 252, 255, 0.92);
}

.prompt-readonly__panel--compiled {
  background: rgba(246, 250, 255, 0.96);
}

.prompt-readonly__panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

.prompt-readonly__panel header div,
.prompt-readonly__runtime div {
  display: grid;
  gap: 4px;
}

.prompt-readonly__panel header span,
.prompt-readonly__runtime span {
  color: #7b8ba3;
  font-size: var(--admin-text-micro);
}

.prompt-readonly__panel pre {
  margin: 0;
  height: min(58vh, 680px);
  overflow: auto;
  padding: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font: 12px/1.65 Consolas, Monaco, monospace;
  color: #263950;
}

.prompt-readonly__runtime {
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(239, 244, 252, 0.82);
}

@media (max-width: 900px) {
  .prompt-readonly__grid {
    grid-template-columns: 1fr;
  }
}
</style>
