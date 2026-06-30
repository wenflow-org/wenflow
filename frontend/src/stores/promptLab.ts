import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { parseSource, serializeSource, type SourceDocument } from '@/utils/sourceParser'

const API = '/api/admin/prompt-lab'

export const usePromptLabStore = defineStore('promptLab', () => {
  const currentStep = ref(0)
  const skillId = ref('goal-conversation')
  const sourceContent = ref('')
  const sourceDocument = ref<SourceDocument | null>(null)
  const compiledPrompt = ref('')
  const compiling = ref(false)
  const compileError = ref<string | null>(null)
  const compileStats = ref<{ lines: number; rules: number; chars: number } | null>(null)
  const sourceList = ref<{ id: string; name: string }[]>([])
  const loadingSource = ref(false)
  const compileSpec = ref('')
  const params = ref<SkillParams>(defaultParams())

  interface SkillParams {
    temperature: number
    maxTokens: number
    model: string | null
    thinkingMode: string
    reasoningEffort: string
  }

  function defaultParams(): SkillParams {
    return { temperature: 0.7, maxTokens: 8000, model: null, thinkingMode: 'default', reasoningEffort: 'default' }
  }

  async function fetchCompileSpec() {
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API}/compile-spec`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        compileSpec.value = result.data || ''
      }
    } catch { /* ignore */ }
  }

  async function fetchParams(id: string) {
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API}/params/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        if (result.data) {
          params.value = { ...defaultParams(), ...result.data }
        }
      }
    } catch { /* ignore */ }
  }

  async function fetchSourceList() {
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API}/sources`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        sourceList.value = result.data || []
      }
    } catch { /* ignore */ }
  }

  async function loadSource(id: string) {
    skillId.value = id
    loadingSource.value = true
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API}/source/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        sourceContent.value = result.data || ''
        sourceDocument.value = parseSource(sourceContent.value)
        return
      }
    } catch { /* fallback */ }
    sourceContent.value = ''
    sourceDocument.value = null
    ElMessage.warning('源文件加载失败')
  }

  function syncSourceFromDocument() {
    if (sourceDocument.value) {
      sourceContent.value = serializeSource(sourceDocument.value)
    }
  }

  async function compile() {
    if (!skillId.value) {
      ElMessage.warning('请先选择 Skill')
      return
    }

    compiling.value = true
    compileError.value = null

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API}/compile-source`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ skillId: skillId.value })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || err.details || '编译失败')
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || '编译失败')
      }

      compiledPrompt.value = result.prompt
      compileStats.value = result.stats
      ElMessage.success('编译成功')
    } catch (error) {
      compileError.value = (error as Error).message
      ElMessage.error('编译失败: ' + (error as Error).message)
      throw error
    } finally {
      compiling.value = false
    }
  }

  async function publish(): Promise<{ version: number; agentId: string }> {
    compiling.value = true
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          skillId: skillId.value,
          prompt: compiledPrompt.value,
          params: params.value
        })
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.error || err.details || '发布失败')
      }

      const result = await resp.json()
      if (!result.success) {
        throw new Error(result.error || '发布失败')
      }

      ElMessage.success(`已发布 v${result.version}`)
      return result
    } catch (error) {
      ElMessage.error('发布失败: ' + (error as Error).message)
      throw error
    } finally {
      compiling.value = false
    }
  }

  function reset() {
    currentStep.value = 0
    sourceContent.value = ''
    sourceDocument.value = null
    compiledPrompt.value = ''
    compileError.value = null
    compileStats.value = null
  }

  return {
    currentStep,
    skillId,
    sourceContent,
    sourceDocument,
    compiledPrompt,
    compiling,
    compileError,
    compileStats,
    sourceList,
    loadingSource,
    compileSpec,
    params,
    fetchSourceList,
    loadSource,
    fetchCompileSpec,
    fetchParams,
    syncSourceFromDocument,
    compile,
    publish,
    reset
  }
})
