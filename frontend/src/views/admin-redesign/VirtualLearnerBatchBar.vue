<template>
  <!-- 批量操作条（全局 mk-batchbar：选中后底部浮现） -->
  <div class="mk-batchbar">
    <span>已选 {{ selected.length }} 人</span>
    <button type="button" class="mk-link" @click="emit('update:selected', [])">取消选择</button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'为每个选中的虚拟学习者启动其全部故事的实验会话（一个故事一个会话）'" @click="batchLaunchAllStories">
      {{ batchActionBusy ? '处理中…' : '启动全部故事' }}
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'对选中虚拟人全部故事的最新会话开启自动驾驶（不新建会话；已运行的自动跳过）'" @click="batchAutopilotStart">
      {{ batchActionBusy ? '处理中…' : '批量启动自动驾驶' }}
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'停止选中虚拟人全部故事最新会话的自动驾驶（学习进度保留，可随时再启动）'" @click="batchAutopilotStop">
      {{ batchActionBusy ? '处理中…' : '批量停止自动驾驶' }}
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" @click="batchTerminate">
      {{ batchActionBusy ? '处理中…' : '批量终止' }}
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" @click="batchReclaim">
      {{ batchActionBusy ? '处理中…' : '批量清理卡死' }}
    </button>
    <button type="button" class="mk-batchbar__danger" :disabled="batchActionBusy" @click="batchDelete">
      批量删除
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { loadLiveData, errMsg } from './live'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import type { VirtualLearnerRow as Sample } from './virtualLearnersTypes'

const props = defineProps<{
  /** 选中的虚拟学习者 id（父页面表格复选框 v-model） */
  selected: string[]
  /** 全量行数据（用于统计故事数/会话数） */
  samples: Sample[]
}>()
const emit = defineEmits<{
  (e: 'update:selected', value: string[]): void
  (e: 'reclaim', profileIds: string[]): void
}>()

/* 批量操作互斥标志：删除/清理/自动驾驶等共用 */
const batchActionBusy = ref(false)

/** 批量启动全部故事：为每个选中的虚拟学习者启动其全部故事的实验会话（一个故事一个会话），
 *  并自动开启自动驾驶（target=final 直达 Path 全部完成），无需手动逐个启动 */
async function batchLaunchAllStories() {
  const ids = [...props.selected]
  if (!ids.length || batchActionBusy.value) return
  // 统计将启动的会话数（先确认，避免误操作）
  let totalStories = 0
  for (const id of ids) {
    const s = props.samples.find((x) => x.id === id)
    totalStories += Number(s?.storyCount ?? 0)
  }
  if (totalStories === 0) {
    toast.error('选中的虚拟学习者都还没有故事；请先在画像页生成故事')
    return
  }
  const ok = await askConfirm({
    title: '启动全部故事（含自动驾驶）',
    message: `将为选中的 ${ids.length} 个虚拟学习者启动其全部故事的实验会话，共约 ${totalStories} 个会话，并自动开启自动驾驶（直达 Path 全部完成）。\n注意：并发多个自动驾驶对 LLM 压力较大，建议分批（每批 1-2 人）。确认启动？`,
    confirmText: `启动 ${totalStories} 个会话`,
    danger: false
  })
  if (!ok) return
  batchActionBusy.value = true
  let launched = 0
  let autopiloted = 0
  let failed = 0
  for (const id of ids) {
    const s = props.samples.find((x) => x.id === id)
    if (!s) continue
    try {
      // 拿该虚拟人的故事列表
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const storyId = String(st.storyId || st.id || st.key || '')
        if (!storyId) continue
        try {
          const sres = await adminVirtualLearnersApi.startVirtualSession(id, { storyId, frictionBudget: 'normal' })
          const session = sres.data?.data ?? sres.data ?? {}
          const sid = String(session.id || session.sessionId || '')
          if (sid) {
            launched++
            // 创建后自动开启自动驾驶（target=final：直达 Path 全部完成）
            try {
              await adminVirtualLearnersApi.autopilotStart(sid, { target: 'final' })
              autopiloted++
            } catch (e) {
              failed++
              console.error(`「${s.name}」故事 ${storyId} 自动驾驶启动失败:`, e)
            }
          }
        } catch (e) {
          failed++
          console.error(`启动「${s.name}」故事会话失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s.name}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (launched > 0) {
    toast.success(`已启动 ${launched} 个会话并开启自动驾驶 ${autopiloted} 个（失败 ${failed}）`)
    emit('update:selected', [])
    void loadLiveData()
  } else {
    toast.error(`启动失败：${failed} 个（请检查故事是否生成）`)
  }
}

/** 批量启动自动驾驶：对选中虚拟人全部故事的最新会话开启自动驾驶（不新建会话；已运行的自动跳过） */
async function batchAutopilotStart() {
  const ids = [...props.selected]
  if (!ids.length || batchActionBusy.value) return
  // 先统计有多少个可启动的会话（有最新会话且非终态）
  let candidates = 0
  for (const id of ids) {
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      candidates += list.filter((st: Record<string, unknown>) => {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const status = String(lr.status || '')
        return !!lr.sessionId && !['completed', 'abandoned'].includes(status)
      }).length
    } catch { /* 统计失败忽略 */ }
  }
  if (!candidates) {
    toast.error('选中的虚拟学习者的故事都还没有可启动的会话；请先「启动全部故事」或单个运行')
    return
  }
  const ok = await askConfirm({
    title: '批量启动自动驾驶',
    message: `将为选中的 ${ids.length} 个虚拟学习者、约 ${candidates} 个最新会话开启自动驾驶（target=final 直达 Path 全部完成）。\n已在运行自动驾驶的会话会自动跳过，不会重复启动。确认启动？`,
    confirmText: `启动 ${candidates} 个会话的自动驾驶`,
    danger: false
  })
  if (!ok) return
  batchActionBusy.value = true
  let started = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const s = props.samples.find((x) => x.id === id)
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const sid = String(lr.sessionId || '')
        const status = String(lr.status || '')
        if (!sid || ['completed', 'abandoned'].includes(status)) { skipped++; continue }
        try {
          await adminVirtualLearnersApi.autopilotStart(sid, { target: 'final' })
          started++
        } catch (e) {
          if (String(errMsg(e)).includes('已有全自动运行')) { skipped++; continue }
          failed++
          console.error(`「${s?.name || id}」会话 ${sid.slice(0, 8)} 自动驾驶启动失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s?.name || id}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (started > 0 || skipped > 0) {
    toast.success(`已启动自动驾驶 ${started} 个${skipped ? `（跳过 ${skipped}）` : ''}${failed ? `，失败 ${failed}` : ''}`)
    emit('update:selected', [])
    void loadLiveData()
  } else {
    toast.error(`启动失败：${failed} 个（请检查故事会话状态）`)
  }
}

/** 批量停止自动驾驶：停止选中虚拟人全部故事最新会话的自动驾驶（学习进度保留） */
async function batchAutopilotStop() {
  const ids = [...props.selected]
  if (!ids.length || batchActionBusy.value) return
  const ok = await askConfirm({
    title: '批量停止自动驾驶',
    message: `将停止选中的 ${ids.length} 个虚拟学习者全部故事最新会话的自动驾驶。\n学习进度与对话保留，可随时再次启动。确认停止？`,
    confirmText: `停止 ${ids.length} 人`,
    danger: false
  })
  if (!ok) return
  batchActionBusy.value = true
  let stopped = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const s = props.samples.find((x) => x.id === id)
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const sid = String(lr.sessionId || '')
        const status = String(lr.status || '')
        if (!sid || ['completed', 'abandoned', 'failed'].includes(status)) { skipped++; continue }
        try {
          await adminVirtualLearnersApi.autopilotStop(sid)
          stopped++
        } catch (e) {
          failed++
          console.error(`「${s?.name || id}」会话 ${sid.slice(0, 8)} 停止失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s?.name || id}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (stopped > 0 || skipped > 0) {
    toast.success(`已停止自动驾驶 ${stopped} 个${skipped ? `（跳过 ${skipped}）` : ''}${failed ? `，失败 ${failed}` : ''}`)
    emit('update:selected', [])
    void loadLiveData()
  } else {
    toast.error(`停止失败：${failed} 个（请检查故事会话状态）`)
  }
}

/** 批量终止：对选中虚拟人全部非终态会话（进行中/创建中）标记 abandoned；只改状态不删数据 */
async function batchTerminate() {
  const ids = [...props.selected]
  if (!ids.length || batchActionBusy.value) return
  const runningSum = ids.reduce((a, id) => {
    const s = props.samples.find((x) => x.id === id)
    return a + (s?.runningCount ?? 0) + (s?.pausedCount ?? 0)
  }, 0)
  const ok = await askConfirm({
    title: '批量终止会话',
    message: `确认终止选中的 ${ids.length} 个虚拟学习者全部非终态会话（进行中 ${runningSum} + 创建中）？\n会话将被标记为「已放弃」（abandoned），数据保留，该操作不可撤销。`,
    confirmText: `终止 ${ids.length} 人`,
    busy: true
  })
  if (!ok) return
  batchActionBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.terminateVirtualSessions({ profileIds: ids, dryRun: false })
    const d = res.data?.data ?? {}
    const terminated = Number(d.terminated ?? 0)
    const skipped = Number(d.skippedTerminal ?? 0)
    toast.success(terminated > 0 ? `已终止 ${terminated} 个会话（跳过已终态 ${skipped}）` : '没有需要终止的非终态会话')
    emit('update:selected', [])
    void loadLiveData()
    doneConfirm()
  } catch (e) {
    toast.error(`批量终止失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    batchActionBusy.value = false
  }
}

/** 批量清理卡死：对选中虚拟人调 reclaim-stale（dryRun 先展示清单再确认执行） */
function batchReclaim() {
  const ids = [...props.selected]
  if (!ids.length) return
  emit('reclaim', ids)
}

/** 批量删除虚拟学习者：级联删除 profile + 全部虚拟数据，不可撤销 */
async function batchDelete() {
  const ids = [...props.selected]
  if (!ids.length || batchActionBusy.value) return
  const ok = await askConfirm({
    title: '批量删除虚拟学习者',
    message: `确认删除选中的 ${ids.length} 个虚拟学习者？\n将级联删除其全部会话、教学记录、学习数据，该操作不可撤销。`,
    confirmText: `删除 ${ids.length} 人`,
    busy: true
  })
  if (!ok) return
  batchActionBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.batchDeleteVirtualLearners(ids)
    const d = res.data?.data ?? {}
    const deleted = (d.deleted || []).length
    const skipped = (d.skipped || []).length
    const errors = (d.errors || []).length
    if (errors > 0) {
      toast.error(`删除 ${deleted} 人，${skipped} 人跳过，${errors} 人失败`)
    } else {
      toast.success(`已删除 ${deleted} 人${skipped > 0 ? `，${skipped} 人跳过` : ''}`)
    }
    emit('update:selected', [])
    void loadLiveData()
    doneConfirm()
  } catch (e) {
    toast.error(`批量删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    batchActionBusy.value = false
  }
}
</script>
