<template>
  <div class="mk-page">
    <div class="mk-status" :class="rows.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ rows.length ? '外挂组件运行正常' : '还没有外挂组件' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 个组件</span>
      <span class="mk-status__meta">独立配置 {{ customCount }}</span>
      <span class="mk-status__meta">继承默认 {{ rows.length - customCount }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openEditor(null)">新增组件</button>
    </div>

    <div v-if="toast" class="mk-toast mk-toast--ok">✓ {{ toast }}</div>

    <div class="mk-card">
      <table v-if="rows.length" class="mk-table">
        <thead>
          <tr>
            <th>组件</th>
            <th>挂载点</th>
            <th>模型</th>
            <th>温度</th>
            <th>状态</th>
            <th>最近调用</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ r.name }}</strong>
                <span class="mk-cell-sub">{{ r.id }}</span>
              </div>
            </td>
            <td><span class="mk-badge mk-badge--muted">{{ r.mount }}</span></td>
            <td class="mono">{{ r.model }}</td>
            <td class="mk-num">{{ r.temp }}</td>
            <td><span class="mk-badge" :class="r.custom ? 'mk-badge--ok' : 'mk-badge--muted'">{{ r.custom ? '独立配置' : '继承默认' }}</span></td>
            <td :class="{ 'mk-na': r.last === '从未' }">{{ r.last }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openEditor(r)">配置</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>还没有外挂组件</strong>
        <span>外挂组件让 Skill 使用独立的模型与参数，而不是全局默认。</span>
      </div>
    </div>

    <!-- 新增 / 配置组件 -->
    <div v-if="editor" class="mk-modal" @mousedown.self="editor = null">
      <div class="mk-modal__panel" role="dialog" aria-label="组件配置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ editor.isNew ? '新增外挂组件' : `配置 · ${editor.row.name}` }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="editor = null">✕</button>
        </div>
        <div class="mk-modal__body">
          <label v-if="editor.isNew" class="mk-field" :class="{ 'mk-field--error': errors.id }">
            <span class="mk-field__label">挂载 Skill</span>
            <select v-model="editor.form.id" class="mk-field__select">
              <option value="">选择 Skill</option>
              <option v-for="s in availableSkills" :key="s" :value="s">{{ s }}</option>
            </select>
            <span v-if="errors.id" class="mk-field__err">{{ errors.id }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">模型</span>
            <select v-model="editor.form.model" class="mk-field__select">
              <option>deepseek-v4-flash</option>
              <option>deepseek-v4-pro</option>
              <option>deepseek-v4-lite</option>
              <option>继承全局</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">温度 · {{ editor.form.temp }}</span>
            <input v-model.number="editor.form.temp" type="range" min="0" max="2" step="0.1" class="mk-field__input" />
            <span class="mk-field__hint">0 更确定，2 更发散</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">最大输出 Tokens</span>
            <input v-model.number="editor.form.maxTokens" type="number" min="32" max="8000" step="32" class="mk-field__input" />
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="editor = null">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" @click="saveEditor">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ state: 'normal' | 'empty' }>()

interface Row {
  id: string
  name: string
  mount: string
  model: string
  temp: string
  custom: boolean
  last: string
}

const all: Row[] = [
  { id: 'goal-conversation', name: '目标对话 Skill', mount: '对话', model: 'deepseek-v4-flash', temp: '0.3', custom: true, last: '4 分钟前' },
  { id: 'generic-planner', name: '路径规划 Skill', mount: '推理', model: 'deepseek-v4-pro', temp: '0.2', custom: true, last: '18 分钟前' },
  { id: 'teaching-round', name: '教学回合 Skill', mount: '对话', model: '继承全局', temp: '0.5', custom: false, last: '42 分钟前' },
  { id: 'basic-evaluator', name: '质量评估 Skill', mount: '评估', model: 'deepseek-v4-pro', temp: '0.1', custom: true, last: '1 小时前' },
  { id: 'session-wrapup', name: '课后产出 Skill', mount: '生成', model: '继承全局', temp: '0.7', custom: false, last: '2 小时前' },
  { id: 'turn-simulator', name: '回合模拟 Skill', mount: '模拟', model: '继承全局', temp: '0.8', custom: false, last: '从未' }
]

const rows = ref<Row[]>([])
watch(
  () => props.state,
  (s) => {
    rows.value = s === 'empty' ? [] : all
  },
  { immediate: true }
)

const customCount = computed(() => rows.value.filter((r) => r.custom).length)

/* 新增 / 配置编辑器 */
interface EditorState {
  isNew: boolean
  row: Row
  form: { id: string; model: string; temp: number; maxTokens: number }
}

const editor = ref<EditorState | null>(null)
const errors = ref<{ id?: string }>({})
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const availableSkills = computed(() => {
  const used = new Set(rows.value.map((r) => r.id))
  return ['turn-simulator', 'path-evaluator', 'knowledge-distill', 'adaptive-guidance-copy'].filter((s) => !used.has(s))
})

function openEditor(row: Row | null) {
  errors.value = {}
  if (row) {
    editor.value = {
      isNew: false,
      row,
      form: { id: row.id, model: row.model === '继承全局' ? '继承全局' : row.model, temp: Number(row.temp), maxTokens: 2048 }
    }
  } else {
    editor.value = {
      isNew: true,
      row: { id: '', name: '', mount: '生成', model: 'deepseek-v4-flash', temp: '0.5', custom: true, last: '从未' },
      form: { id: '', model: 'deepseek-v4-flash', temp: 0.5, maxTokens: 2048 }
    }
  }
}

function saveEditor() {
  if (!editor.value) return
  const { isNew, row, form } = editor.value
  if (isNew && !form.id) {
    errors.value = { id: '请选择挂载的 Skill' }
    return
  }

  if (isNew) {
    rows.value.unshift({
      id: form.id,
      name: `${form.id} Skill`,
      mount: '生成',
      model: form.model,
      temp: form.temp.toFixed(1),
      custom: form.model !== '继承全局',
      last: '从未'
    })
    showToast(`组件 ${form.id} 已创建`)
  } else {
    row.model = form.model
    row.temp = form.temp.toFixed(1)
    row.custom = form.model !== '继承全局'
    row.last = '刚刚'
    showToast(`「${row.name}」配置已保存`)
  }
  editor.value = null
}

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}
</script>

<style scoped>
.mono { font-family: var(--mk-mono); font-size: 12px; }
</style>
