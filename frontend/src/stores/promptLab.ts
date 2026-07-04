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
  const manifest = ref<PromptLabManifest>(defaultManifest('goal-conversation'))
  const loadingManifest = ref(false)
  const sourceDirty = ref(false)
  const manifestDirty = ref(false)
  let loadToken = 0
  const compiledPrompt = ref('')
  const compiling = ref(false)
  const compileError = ref<string | null>(null)
  const compileStats = ref<{ lines: number; rules: number; chars: number } | null>(null)
  const sourceList = ref<{ id: string; name: string }[]>([])
  const loadingSource = ref(false)
  const compileSpec = ref('')
  const params = ref<SkillParams>(defaultParams())

  interface SkillParams {
    tier: string
    temperature: number
    maxTokens: number
    model: string | null
    thinkingMode: string
    reasoningEffort: string
  }

  interface PromptLabManifest {
    version: string
    skillId: string
    agentId: string
    name: string
    archetype: string
    description: string
    acceptableAgentIds: string[]
    publish: {
      enabled: boolean
      exportTargets: string[]
    }
    runtimeDefaults: SkillParams
    ownership: {
      tier: string
      visibility: string
    }
    tags: string[]
    notes: string
  }

  function defaultParams(): SkillParams {
    return {
      tier: 'chat',
      temperature: 0.7,
      maxTokens: 8000,
      model: null,
      thinkingMode: 'default',
      reasoningEffort: 'default'
    }
  }

  function defaultManifest(id: string): PromptLabManifest {
    return {
      version: 'prompt-lab-manifest/v1',
      skillId: id,
      agentId: `skill:${id}`,
      name: `default-skill-${id}`,
      archetype: 'conversational',
      description: '',
      acceptableAgentIds: [],
      publish: {
        enabled: true,
        exportTargets: ['platform-prompts']
      },
      runtimeDefaults: defaultParams(),
      ownership: {
        tier: 'production',
        visibility: 'internal'
      },
      tags: [],
      notes: ''
    }
  }

  function normalizeManifest(id: string, payload: any): PromptLabManifest {
    const base = defaultManifest(id)
    const next = payload && typeof payload === 'object' ? payload : {}
    return {
      ...base,
      ...next,
      skillId: id,
      agentId: typeof next.agentId === 'string' && next.agentId.trim() ? next.agentId.trim() : base.agentId,
      name: typeof next.name === 'string' && next.name.trim() ? next.name.trim() : base.name,
      archetype: typeof next.archetype === 'string' && next.archetype.trim() ? next.archetype.trim() : base.archetype,
      description: typeof next.description === 'string' ? next.description : base.description,
      acceptableAgentIds: Array.isArray(next.acceptableAgentIds) ? next.acceptableAgentIds.filter(Boolean) : base.acceptableAgentIds,
      publish: {
        ...base.publish,
        ...(next.publish || {})
      },
      runtimeDefaults: {
        ...defaultParams(),
        ...(next.runtimeDefaults || {})
      },
      ownership: {
        ...base.ownership,
        ...(next.ownership || {})
      },
      tags: Array.isArray(next.tags) ? next.tags.filter(Boolean) : base.tags,
      notes: typeof next.notes === 'string' ? next.notes : base.notes
    }
  }

  function getPromptLabToken() {
    return localStorage.getItem('admin_token')
      || sessionStorage.getItem('admin_token')
      || localStorage.getItem('token')
      || sessionStorage.getItem('token')
      || ''
  }

  function markSourceDirty() {
    sourceDirty.value = true
    compiledPrompt.value = ''
    compileError.value = null
    compileStats.value = null
  }

  function markManifestDirty() {
    manifestDirty.value = true
    compiledPrompt.value = ''
    compileError.value = null
    compileStats.value = null
  }

  async function fetchCompileSpec() {
    try {
      const token = getPromptLabToken()
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
      const token = getPromptLabToken()
      const resp = await fetch(`${API}/params/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        if (result.data) {
          params.value = { ...defaultParams(), ...result.data }
          manifest.value = {
            ...manifest.value,
            runtimeDefaults: { ...params.value }
          }
        }
      }
    } catch { /* ignore */ }
  }

  async function fetchSourceList() {
    try {
      const token = getPromptLabToken()
      const resp = await fetch(`${API}/sources`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        sourceList.value = result.data || []
        if (!sourceList.value.some((item) => item.id === skillId.value) && sourceList.value.length > 0) {
          skillId.value = sourceList.value[0].id
        }
        return
      }
      ElMessage.warning('Skill 列表加载失败')
    } catch { /* ignore */ }
  }

  async function loadSource(id: string) {
    const currentLoadToken = ++loadToken
    skillId.value = id
    loadingSource.value = true
    compiledPrompt.value = ''
    compileError.value = null
    compileStats.value = null
    try {
      const token = getPromptLabToken()
      const resp = await fetch(`${API}/source/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        if (currentLoadToken !== loadToken) return
        sourceContent.value = result.data || ''
        sourceDocument.value = parseSource(sourceContent.value)
        sourceDirty.value = false
      } else {
        if (currentLoadToken !== loadToken) return
        sourceContent.value = ''
        sourceDocument.value = null
      }
    } catch { /* fallback */ }
    if (currentLoadToken !== loadToken) return
    if (!sourceDocument.value) {
      ElMessage.warning('源文件加载失败')
    }
    loadingSource.value = false
    await loadManifest(id, currentLoadToken)
  }

  async function loadManifest(id: string, requestToken = loadToken) {
    loadingManifest.value = true
    try {
      const authToken = getPromptLabToken()
      const resp = await fetch(`${API}/manifest/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      })
      if (resp.ok) {
        const result = await resp.json()
        if (requestToken !== loadToken) return
        manifest.value = normalizeManifest(id, result.data)
        params.value = { ...manifest.value.runtimeDefaults }
        manifestDirty.value = false
      } else {
        if (requestToken !== loadToken) return
        ElMessage.warning('元数据加载失败，已回退到默认 manifest')
        manifest.value = defaultManifest(id)
        params.value = { ...manifest.value.runtimeDefaults }
        manifestDirty.value = false
      }
    } catch {
      if (requestToken !== loadToken) return
      ElMessage.warning('元数据加载失败，已回退到默认 manifest')
      manifest.value = defaultManifest(id)
      params.value = { ...manifest.value.runtimeDefaults }
      manifestDirty.value = false
    } finally {
      loadingManifest.value = false
    }
  }

  async function saveManifest(id: string) {
    const token = getPromptLabToken()
    const payload = {
      ...manifest.value,
      skillId: id,
      runtimeDefaults: {
        ...params.value
      }
    }
    const resp = await fetch(`${API}/manifest/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ manifest: payload })
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error || err.details || '保存 manifest 失败')
    }

    const result = await resp.json()
    manifest.value = normalizeManifest(id, result.data)
    params.value = { ...manifest.value.runtimeDefaults }
    manifestDirty.value = false
  }

  async function saveSource(id: string, content: string) {
    const token = getPromptLabToken()
    const resp = await fetch(`${API}/source/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ content })
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error || err.details || '保存源文件失败')
    }

    const result = await resp.json()
    sourceContent.value = result.data || content
    sourceDocument.value = parseSource(sourceContent.value)
    sourceDirty.value = false
  }

  function syncSourceFromDocument() {
    if (sourceDocument.value) {
      sourceContent.value = serializeSource(sourceDocument.value)
      markSourceDirty()
    }
  }

  async function persistDrafts(targetSkillId?: string) {
    const id = targetSkillId || skillId.value
    if (sourceDirty.value && sourceDocument.value) {
      await saveSource(id, sourceContent.value)
    }
    if (manifestDirty.value) {
      await saveManifest(id)
    }
  }

  async function createSourceFile(id: string) {
    const token = getPromptLabToken()
    const resp = await fetch(`${API}/source/${id}/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error || err.details || '创建源文件失败')
    }
    await loadSource(id)
  }

  async function compile() {
    if (!skillId.value) {
      ElMessage.warning('请先选择 Skill')
      return
    }

    compiling.value = true
    compileError.value = null

    try {
      const token = getPromptLabToken()
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

  async function publish(): Promise<{
    version: number
    agentId: string
    compileStatus?: string | null
    compileWarnings?: string[]
    compileError?: string | null
  }> {
    compiling.value = true
    try {
      const token = getPromptLabToken()
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
    manifest.value = defaultManifest(skillId.value)
    sourceDirty.value = false
    manifestDirty.value = false
    compiledPrompt.value = ''
    compileError.value = null
    compileStats.value = null
  }

  return {
    currentStep,
    skillId,
    sourceContent,
    sourceDocument,
    manifest,
    loadingManifest,
    sourceDirty,
    manifestDirty,
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
    loadManifest,
    saveSource,
    saveManifest,
    persistDrafts,
    createSourceFile,
    fetchCompileSpec,
    fetchParams,
    syncSourceFromDocument,
    markManifestDirty,
    compile,
    publish,
    reset
  }
})
