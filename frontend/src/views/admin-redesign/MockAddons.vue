<template>
  <div class="mk-page">
    <div class="mk-status" :class="rows.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ rows.length ? '外挂组件运行正常' : '还没有外挂组件' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 个组件</span>
      <span class="mk-status__meta">独立配置 {{ customCount }}</span>
      <span class="mk-status__meta">继承默认 {{ rows.length - customCount }}</span>
      <span class="mk-status__hint">编辑统一在 Skill 抽屉进行</span>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="mk-card">
      <div class="addon-scroll">
        <table v-if="rows.length" class="mk-table">
          <thead>
            <tr>
              <th>组件</th>
              <th>档位</th>
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
                  <button type="button" class="mk-link" @click="openSkillDrawer(r.id)">详情 / 配置</button>
                  <button type="button" class="mk-link" @click="goLogs(r.id)">日志</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="!rows.length" class="mk-empty">
          <strong>还没有外挂组件</strong>
          <span>外挂能力 Skill（检索 / 解析类）的平台配置入口。</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource, openSkillDrawer, investigateAgent } from './mockStore'
import { timeAgo, errMsg } from './mockLive'
import { adminSkillsApi } from '@/api/adminApi'
import { EXTRA_COMPONENT_VISIBLE_SKILLS } from '@/views/admin/capabilityCatalog'

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

/* demo 数据 */
const all: Row[] = [
  { id: 'text-structure-analyzer', name: '文本结构分析器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' },
  { id: 'retrieval', name: '内容检索器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' },
  { id: 'web-extractor', name: '网页内容提取器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' },
  { id: 'image-analyzer', name: '图片分析器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' },
  { id: 'memory-search', name: '学习记忆搜索器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' },
  { id: 'smart-search', name: '智能搜索器', mount: 'chat', model: '继承全局', temp: '0.7', custom: false, last: '从未' }
]

const rows = ref<Row[]>([])
const loading = ref(false)

async function loadRows() {
  loading.value = true
  try {
    const res = await adminSkillsApi.getSkillModelConfigs()
    const body = res.data?.data ?? res.data ?? []
    const items = Array.isArray(body) ? body : body.items || body.configs || []
    // 与生产外挂组件页同口径：仅白名单内的外挂能力 Skill
    rows.value = items
      .filter((c: Record<string, unknown>) => EXTRA_COMPONENT_VISIBLE_SKILLS.has(String(c.skillId || '')))
      .map((c: Record<string, unknown>) => ({
        id: String(c.skillId || c.id),
        name: String(c.displayName || c.skillId || c.id),
        mount: String(c.tier || 'chat'),
        model: c.model ? String(c.model) : '继承全局',
        temp: Number(c.temperature ?? 0.7).toFixed(1),
        custom: !!c.model,
        last: timeAgo(c.lastCalledAt as string)
      }))
  } catch (e) {
    rows.value = []
    showToast(`配置加载失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.state, dataSource.value] as const,
  ([state, source]) => {
    if (source === 'live') void loadRows()
    else rows.value = state === 'empty' ? [] : all.map((r) => ({ ...r }))
  },
  { immediate: true }
)

const customCount = computed(() => rows.value.filter((r) => r.custom).length)

/* 跳转：编辑统一在 Skill 抽屉；日志跳执行日志（已过滤） */
function goLogs(skillId: string) {
  investigateAgent(skillId)
}

const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}
</script>

<style scoped>
.mono { font-family: var(--mk-mono); font-size: 12px; }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.addon-scroll {
  max-height: 62vh;
  overflow-y: auto;
}
.addon-scroll thead th {
  position: sticky;
  top: 0;
  background: var(--mk-surface);
  z-index: 1;
}
.mk-status__hint { font-size: 11.5px; color: var(--mk-faint); margin-left: auto; }
</style>
