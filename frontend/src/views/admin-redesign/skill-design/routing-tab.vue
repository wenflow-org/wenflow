<template>
  <!-- 字段路由（skill 维度 · 加字段向导闭环）+ 字段血缘（原协议 pill 并入，折叠块） -->
  <div class="sdp-pane sdp-routing">
    <details class="sdp-routing__lineage" @toggle="onLineageToggle">
      <!-- 2026-11-02 评审：这里只列出有下游消费者的字段（9 个），而下方「契约 · 阶段 x」写产出 26 行，
           两个数字没交代关系。标题与说明显式说清「没有下游消费者的字段不在此列」。 -->
      <summary>字段影响范围（有下游消费者的产出字段 → 下游消费者）</summary>
      <MkLoading v-if="lineageLoading" inline text="影响范围加载中…" />
      <table v-else-if="lineage.length" class="mk-table mk-table--dense sdp-routing__table">
        <thead>
          <tr>
            <th scope="col">字段</th>
            <th scope="col">
              消费者
              <span class="sdp-routing__scope">（{{ lineage.length }} 个字段有下游消费者，其余产出字段没有消费者，不在本表）</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, i) in lineage" :key="i">
            <td class="mono">{{ entry.field }}</td>
            <td><div v-for="(c, j) in entry.consumers" :key="j" class="sdp-routing__consumer">{{ c }}</div></td>
          </tr>
        </tbody>
      </table>
      <!-- 失败 ≠「确实没有登记」：失败态显式报错 + 重试（失败后 lineageLoaded 复位，收起再展开可重拉） -->
      <p v-else-if="lineageError" class="sdp-none sdp-bad-text">
        影响范围加载失败：{{ lineageError }}
        <button type="button" class="mk-link" @click="retryLineage">重试</button>
      </p>
      <p v-else class="sdp-none">该 skill 暂无影响范围记录（没有下游消费者，或尚未登记）</p>
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
import SkillFieldRouting from '../SkillFieldRouting.vue'
import { errText } from './sdp-shared'
import MkLoading from '@/components/mk/MkLoading.vue'

const props = defineProps<{ skillId: string }>()

interface CoreLineageEntry { field: string; consumers: string[] }
const lineage = ref<CoreLineageEntry[]>([])
const lineageLoading = ref(false)
const lineageError = ref('')
let lineageLoaded = false

async function loadLineage() {
  const id = props.skillId
  lineageLoading.value = true
  lineageError.value = ''
  try {
    const res = await adminPromptWorkbenchApi.getCoreLineage(id)
    if (id !== props.skillId) return
    lineage.value = res.data?.lineage || []
  } catch (e) {
    if (id !== props.skillId) return
    lineage.value = []
    lineageError.value = errText(e)
    // 失败不算「已加载」：复位标志，收起再展开或点重试可重新拉取
    lineageLoaded = false
  } finally {
    if (id === props.skillId) lineageLoading.value = false
  }
}

/** 重试（失败态按钮）：显式重拉，不依赖折叠块开合 */
function retryLineage() {
  lineageLoaded = true
  void loadLineage()
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
    lineageError.value = ''
  },
  { immediate: true }
)
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
/* 2026-11-02 评审：契约编辑页右端被窗口边缘裁掉（操作列只剩半个按钮、状态条的按钮文字被切）。
   grid 子项默认 min-width:auto 会被宽表撑开，内层 overflow-x 的滚动条因此拿不到宽度；
   与 SkillDetail `.skd-pane > *` / mk-primitives `.mk-page > *` 同款修法。 */
.sdp-pane > * { min-width: 0; }
.sdp-routing__lineage {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  padding: 10px 14px;
}
.sdp-routing__lineage summary {
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  user-select: none;
}
.sdp-routing__lineage summary:hover { color: var(--mk-ink); }
/* 血缘明细是页内嵌小表：走共享 .mk-table + --dense 密度档，不再自带一套表头/行线/内边距
   （此前它连 .mk-table 都没挂，是页内第三套表格方言）。 */
.sdp-routing__table { margin-top: 8px; }
/* 表头里的范围说明：小字弱色，与列名同排（不是新开一行的卡内说明） */
.sdp-routing__scope { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-faint); }
.sdp-routing__consumer { font-size: var(--mk-fs-micro); color: var(--mk-muted); padding: 1px 0; }
.sdp-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
/* 血缘加载失败：红字（与同单元 SkillFieldRouting 错误态同语言） */
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }

/* 暗色模式 */
[data-theme='dark'] .sdp-routing__lineage { background: var(--wf-bg-subtle); }

</style>