import { ref, type Ref } from 'vue'

/**
 * 保存视图（Saved Views）：把当前筛选组合存进 localStorage，一键恢复。
 * ExecLogs / AuditLogs 共用；快照键与各页 URL query 键保持同名，view 即「可命名的深链」。
 */
export interface SavedView {
  id: string
  name: string
  /** 筛选快照（仅含非默认值；键与页面 URL query 同名） */
  query: Record<string, string>
  createdAt: number
}

/** 上限防刷屏：满员后淘汰最旧（非当前高频动作，不弹提示） */
const MAX_VIEWS = 12

/** 两个筛选快照是否完全一致（用于高亮「当前筛选恰好命中的视图」） */
export function sameViewQuery(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => a[k] === b[k])
}

export function useSavedViews(storageKey: string): {
  views: Ref<SavedView[]>
  save: (name: string, query: Record<string, string>) => string
  remove: (id: string) => void
} {
  const views = ref<SavedView[]>(load())

  function load(): SavedView[] {
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (v): v is SavedView =>
          !!v &&
          typeof v === 'object' &&
          typeof (v as SavedView).id === 'string' &&
          typeof (v as SavedView).name === 'string' &&
          !!(v as SavedView).query &&
          typeof (v as SavedView).query === 'object'
      )
    } catch {
      return []
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(views.value))
    } catch {
      // 隐私模式/配额失败：内存态仍可用，静默
    }
  }

  /** 保存视图；同名覆盖（幂等，防 pill 刷屏）。返回最终生效名称 */
  function save(name: string, query: Record<string, string>): string {
    const finalName = name.trim().slice(0, 24) || '未命名视图'
    const at = views.value.findIndex((v) => v.name === finalName)
    const existing = at >= 0 ? views.value[at] : undefined
    const view: SavedView = {
      id: existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: finalName,
      query: { ...query },
      createdAt: Date.now(),
    }
    if (existing) views.value.splice(at, 1, view)
    else {
      views.value.push(view)
      while (views.value.length > MAX_VIEWS) views.value.shift()
    }
    persist()
    return finalName
  }

  function remove(id: string) {
    views.value = views.value.filter((v) => v.id !== id)
    persist()
  }

  return { views, save, remove }
}
