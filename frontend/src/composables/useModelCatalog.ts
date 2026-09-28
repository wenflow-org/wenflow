/**
 * 模型目录共享加载（File-as-Truth，backend/config/llm-providers.json）。
 *
 * /api/config/available-models 返回带供应商维度的模型清单（providerId/providerName/
 * 供应商端点），各模型选择器用它做 datalist 候选与「供应商 · tier」标注。
 * 模块级缓存：一次加载全应用复用；目录加载失败静默降级为空清单（选择器退化为自由输入，
 * 不阻塞页面）——目录是辅助候选，不该成为路由配置页的单点依赖。
 */
import { computed, ref } from 'vue'
import { adminApiConfigApi } from '@/api/adminApi'

export interface ModelCatalogEntry {
  id: string
  label?: string
  tier?: string
  providerId?: string
  providerName?: string
  /** 该模型所属供应商是否自带端点（llm-providers.json 声明了 baseUrl） */
  hasOwnEndpoint?: boolean
}

export interface ModelCatalogOption {
  value: string
  /** datalist option 的展示标注，如「DeepSeek 官方 · chat」 */
  label: string
}

const models = ref<ModelCatalogEntry[]>([])
const loadFailed = ref(false)
let loaded = false
let loading: Promise<void> | null = null

export function useModelCatalog() {
  async function load(): Promise<void> {
    if (loaded || loading) {
      await loading
      return
    }
    loading = adminApiConfigApi
      .getModelCatalog()
      .then((res: { data?: { data?: { models?: ModelCatalogEntry[] } } }) => {
        models.value = res.data?.data?.models ?? []
        loaded = true
      })
      .catch(() => {
        loadFailed.value = true
      })
      .finally(() => {
        loading = null
      })
    await loading
  }

  const options = computed<ModelCatalogOption[]>(() =>
    models.value.map((m) => ({
      value: m.id,
      label: [m.providerName || m.providerId, m.tier].filter(Boolean).join(' · ')
    }))
  )

  /** 目录中不存在的模型 id（已保存的历史值/通道拉取值），仍需出现在候选里 */
  function extraIds(current: readonly string[]): string[] {
    return current.filter((id) => id && !models.value.some((m) => m.id === id))
  }

  return { models, options, loadFailed, load, extraIds }
}
