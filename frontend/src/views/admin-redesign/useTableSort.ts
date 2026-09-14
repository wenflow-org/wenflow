/**
 * 客户端表格排序（单源）：排序状态 + 稳定比较器 + 可访问性语义 +（可选）本地持久化。
 *
 * ⚠️ 适用范围：**数据完整**的列表（全量已在客户端，例如 Skill 运行页 / 字段路由表）。
 * 截断列表（后端 limit:50/100 的「前缀」）与服务端分页列表不要用本组合式——
 * 它们只会排当前这一批，会产生「看起来全量、其实只排了前 N 行」的误导。
 *
 * 用法（可排序表头）：
 *   const { toggle, sortState, sortRows } = useTableSort<Row>({ accessors: { rate: (r) => r.rate } })
 *   <th :aria-sort="sortState('rate')" @click="toggle('rate')">
 *     <button type="button" class="mk-th__btn" @click.stop="toggle('rate')">成功率…</button>
 *   </th>
 *   const paged = computed(() => sortRows(filtered.value).slice(start, start + pageSize))
 *
 * 用法（下拉式，窄列表头不适合放箭头时）：
 *   const { sortKey, sortDir, toggleDir, sortRows } = useTableSort<T>({ accessors })
 *   <select v-model="sortKey">…</select><button @click="toggleDir">{{ sortDir === 'asc' ? '升序' : '降序' }}</button>
 */
import { ref, type Ref } from 'vue'

export type SortDir = 'asc' | 'desc'
export type SortValue = string | number | boolean | null | undefined
/** 与 aria-sort 取值一致，可直接绑定 */
export type SortState = 'ascending' | 'descending' | 'none'

export interface UseTableSortOptions<T> {
  /** 列 key → 取值器（返回值用于比较；空值恒排末尾，不随升降序翻转） */
  accessors: Record<string, (row: T) => SortValue>
  /** 默认排序键；不传则点击前保持数据原始顺序（不排序） */
  defaultKey?: string
  /** 默认方向（默认 'desc'） */
  defaultDir?: SortDir
  /** 可选：localStorage 键，记住上次排序（与 MkCols 的持久化约定一致） */
  storageKey?: string
}

export interface UseTableSort<T> {
  sortKey: Ref<string>
  sortDir: Ref<SortDir>
  /** 点击表头：同列切换升/降序，换列用默认方向 */
  toggle: (key: string) => void
  /** 仅翻转方向（配合下拉式选择字段使用） */
  toggleDir: () => void
  isSortable: (key: string) => boolean
  /** 供 <th :aria-sort> 直接绑定 */
  sortState: (key: string) => SortState
  /** 按当前状态排序（稳定；未选键时原样返回） */
  sortRows: (rows: T[]) => T[]
  /** 回到默认排序（或原始顺序） */
  reset: () => void
}

interface SortSnapshot {
  key: string
  dir: SortDir
}

function readSnapshot(storageKey: string | undefined, keys: string[]): SortSnapshot | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { key?: unknown; dir?: unknown }
    if (typeof parsed.key !== 'string' || !keys.includes(parsed.key)) return null
    return { key: parsed.key, dir: parsed.dir === 'asc' ? 'asc' : 'desc' }
  } catch {
    return null // 隐私模式 / 脏数据：忽略
  }
}

/** 空值恒排末尾；数字按大小；布尔按真假；其余按 zh 本地化字符串比较 */
function compareValues(a: SortValue, b: SortValue, dir: number): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0
    return aEmpty ? 1 : -1
  }
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir
  if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * dir
  return String(a).localeCompare(String(b), 'zh') * dir
}

export function useTableSort<T>(options: UseTableSortOptions<T>): UseTableSort<T> {
  const keys = Object.keys(options.accessors)
  const saved = readSnapshot(options.storageKey, keys)
  const validDefault = options.defaultKey && keys.includes(options.defaultKey) ? options.defaultKey : ''
  const sortKey = ref(saved?.key ?? validDefault)
  const sortDir = ref<SortDir>(saved?.dir ?? options.defaultDir ?? 'desc')

  function persist() {
    if (!options.storageKey) return
    try {
      localStorage.setItem(options.storageKey, JSON.stringify({ key: sortKey.value, dir: sortDir.value }))
    } catch {
      /* 配额/隐私模式：忽略 */
    }
  }

  function isSortable(key: string) {
    return keys.includes(key)
  }

  function toggle(key: string) {
    if (!isSortable(key)) return
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey.value = key
      sortDir.value = options.defaultDir ?? 'desc'
    }
    persist()
  }

  function toggleDir() {
    if (!sortKey.value) return
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    persist()
  }

  function sortState(key: string): SortState {
    if (sortKey.value !== key) return 'none'
    return sortDir.value === 'asc' ? 'ascending' : 'descending'
  }

  function sortRows(rows: T[]): T[] {
    const key = sortKey.value
    const accessor = key ? options.accessors[key] : undefined
    if (!accessor) return rows
    const dir = sortDir.value === 'asc' ? 1 : -1
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = compareValues(accessor(a.row), accessor(b.row), dir)
        return cmp !== 0 ? cmp : a.index - b.index // 稳定排序：同值保持原序
      })
      .map((item) => item.row)
  }

  function reset() {
    sortKey.value = validDefault
    sortDir.value = options.defaultDir ?? 'desc'
    persist()
  }

  return { sortKey, sortDir, toggle, toggleDir, isSortable, sortState, sortRows, reset }
}
