<template>
  <!-- 字段路由（skill 维度 · 加字段向导闭环）+ 字段血缘（原协议 pill 并入，折叠块） -->
  <div class="sdp-pane sdp-routing">
    <details class="sdp-routing__lineage" @toggle="onLineageToggle">
      <summary>字段血缘（产出字段 → 下游消费者 / 爆炸半径）</summary>
      <div v-if="lineageLoading" class="sdp-none">血缘加载中…</div>
      <table v-else-if="lineage.length" class="sdp-routing__table">
        <thead><tr><th>字段</th><th>消费者（爆炸半径）</th></tr></thead>
        <tbody>
          <tr v-for="(entry, i) in lineage" :key="i">
            <td class="mono">{{ entry.field }}</td>
            <td><div v-for="(c, j) in entry.consumers" :key="j" class="sdp-routing__consumer">{{ c }}</div></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="sdp-none">该 skill 暂无血缘注册（后台消费或未登记）</p>
    </details>

    <SkillFieldRouting :key="skillId" :skill-id="skillId" />
  </div>
</template>

<script setup lang="ts">
/**
 * 字段路由 tab：SkillFieldRouting（向导 M1-M3 完整保留）+ 字段血缘折叠块
 * （原协议 tab 的「字段血缘」pill 并入此处，消除职责重叠）
 */
import { ref, watch } from 'vue'
import { adminPromptWorkbenchApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import SkillFieldRouting from '../SkillFieldRouting.vue'
import { errText } from './sdp-shared'

const props = defineProps<{ skillId: string }>()

interface CoreLineageEntry { field: string; consumers: string[] }
const lineage = ref<CoreLineageEntry[]>([])
const lineageLoading = ref(false)
let lineageLoaded = false

async function loadLineage() {
  const id = props.skillId
  lineageLoading.value = true
  try {
    const res = await adminPromptWorkbenchApi.getCoreLineage(id)
    if (id !== props.skillId) return
    lineage.value = res.data?.lineage || []
  } catch (e) {
    if (id !== props.skillId) return
    toast.error(`血缘加载失败：${errText(e)}`)
  } finally {
    if (id === props.skillId) lineageLoading.value = false
  }
}

/** 折叠块首次展开才拉数据（懒加载） */
function onLineageToggle(e: Event) {
  if ((e.target as HTMLDetailsElement).open && !lineageLoaded) {
    lineageLoaded = true
    void loadLineage()
  }
}

/* 切换 skill：血缘缓存与数据复位 */
watch(
  () => props.skillId,
  () => {
    lineageLoaded = false
    lineage.value = []
  },
  { immediate: true }
)
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
.sdp-routing__lineage {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: #fff;
  padding: 10px 14px;
}
.sdp-routing__lineage summary {
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted);
  user-select: none;
}
.sdp-routing__lineage summary:hover { color: var(--mk-ink); }
.sdp-routing__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 8px;
}
.sdp-routing__table th, .sdp-routing__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #f0f2f5;
}
.sdp-routing__table th { font-size: 11px; color: var(--mk-faint); font-weight: 700; }
.sdp-routing__consumer { font-size: 11px; color: var(--mk-muted); padding: 1px 0; }
.sdp-none { margin: 0; font-size: 12px; color: var(--mk-faint); }
</style>
