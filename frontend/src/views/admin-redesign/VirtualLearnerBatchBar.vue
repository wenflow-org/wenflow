<template>
  <!-- 底部命令栏（全局 mk-batchbar：选中 ≥1 人后由父页 v-if 挂出）
       2026-11-08 用户走查（图2「一串冰糖葫芦 / 一排红色自毁按钮」）：
       ① 去掉每颗按钮重复的「批量」前缀——左侧「已选 N 项」已说明这是批量动作；
       ② 按语义分三档并加竖线隔离：正向主操作（启动故事，蓝底白字）→ 常规（开/停自动驾驶，
          中性灰底）→ 危险区（终止 / 删除，红字细框 / 实心红）；
       ③ 「清理无响应」是全局维护动作（右上角「维护」菜单里已有），且只在勾选含无响应项时才有意义，
          不再常驻命令栏——见父页 reclaim 入口；
       ④ 进度读数单独成弱化文本，不再把每颗按钮的文案都替换成「处理中…」而看不出谁在跑。 -->
  <div class="mk-batchbar">
    <span class="mk-batchbar__count">已选 {{ selected.length }} 项</span>
    <button type="button" class="mk-link mk-batchbar__cancel" @click="emit('update:selected', [])">取消选择</button>
    <span v-if="batchActionBusy" class="mk-batchbar__progress">处理中{{ batchProgress }}</span>
    <span class="mk-batchbar__sep" aria-hidden="true"></span>
    <button type="button" class="mk-batchbar__primary" :disabled="batchActionBusy" :title="'为每个选中的虚拟学习者启动其全部故事的实验会话（一个故事一个会话）'" @click="batchLaunchAllStories">
      ▶ 启动故事
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'对选中虚拟人全部故事的最新会话开启自动驾驶（不新建会话，已运行的自动跳过）'" @click="batchAutopilotStart">
      开启自动驾驶
    </button>
    <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'停止选中虚拟人全部故事最新会话的自动驾驶（学习进度保留，可随时再启动）'" @click="batchAutopilotStop">
      停止自动驾驶
    </button>
    <!-- 全局维护性质的「清理无响应」只在勾选行里真有卡死会话时才出现（2026-11-08 用户：
         旧版对「已停止」的行也常驻这颗按钮，点了什么都不会发生，读作误操作） -->
    <button
      v-if="stalledSelectedCount"
      type="button"
      class="mk-batchbar__btn"
      :disabled="batchActionBusy"
      :title="`对选中的 ${stalledSelectedCount} 个含无响应会话的虚拟学习者先列清单再确认回收`"
      @click="batchReclaim"
    >
      清理无响应（{{ stalledSelectedCount }}）
    </button>
    <span class="mk-batchbar__sep" aria-hidden="true"></span>
    <button type="button" class="mk-batchbar__danger-ghost" :disabled="batchActionBusy" title="终止选中虚拟人的全部未结束会话（标记为已放弃，数据保留，不可撤销）" @click="batchTerminate">
      终止
    </button>
    <button type="button" class="mk-batchbar__danger" :disabled="batchActionBusy" title="删除选中虚拟学习者及其全部会话 / 学习数据（不可撤销）" @click="batchDelete">
      删除
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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
/* 逐人循环进度（(i/n)）：批量启动/自动驾驶要串行打几十个请求，无进度会像卡死 */
const batchProgress = ref('')

/** 批量域「故事列表拉取失败」日志前缀（R6 单源：批量启动/自动驾驶/停止三处同用一句） */
const storyListFailLog = (name: string) => `获取「${name}」故事列表失败:`

/** 选中行里含「无响应」卡死会话的人数——只有这时才给「清理无响应」入口（避免对静止行点了没反应的按钮） */
const stalledSelectedCount = computed(() =>
  props.selected.filter((id) => (props.samples.find((x) => x.id === id)?.stalledCount ?? 0) > 0).length
)

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
    toast.error('选中的虚拟学习者都还没有故事。请先在画像页生成故事')
    return
  }
  const ok = await askConfirm({
    title: '启动全部故事（含自动驾驶）',
    message: `将为选中的 ${ids.length} 个虚拟学习者启动其全部故事的实验会话，共约 ${totalStories} 个会话，并自动开启自动驾驶（直达路径全部完成）。\n注意：并发多个自动驾驶对 LLM 压力较大，建议分批（每批 1-2 人）。确认启动？`,
    confirmText: `启动 ${totalStories} 个会话`,
    danger: false
  })
  if (!ok) return
  batchActionBusy.value = true
  let launched = 0
  let autopiloted = 0
  let failed = 0
  for (const [i, id] of ids.entries()) {
    batchProgress.value = `(${i + 1}/${ids.length})`
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
      console.error(storyListFailLog(s.name), e)
    }
  }
  batchActionBusy.value = false
  batchProgress.value = ''
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
    toast.error('选中的虚拟学习者的故事都还没有可启动的会话。请先「启动全部故事」或单个运行')
    return
  }
  const ok = await askConfirm({
    title: '批量启动自动驾驶',
    message: `将为选中的 ${ids.length} 个虚拟学习者、约 ${candidates} 个最新会话开启自动驾驶（直达路径全部完成）。\n已在运行自动驾驶的会话会自动跳过，不会重复启动。确认启动？`,
    confirmText: `启动 ${candidates} 个会话的自动驾驶`,
    danger: false
  })
  if (!ok) return
  batchActionBusy.value = true
  let started = 0
  let skipped = 0
  let failed = 0
  for (const [i, id] of ids.entries()) {
    batchProgress.value = `(${i + 1}/${ids.length})`
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
      console.error(storyListFailLog(s?.name || id), e)
    }
  }
  batchActionBusy.value = false
  batchProgress.value = ''
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
  for (const [i, id] of ids.entries()) {
    batchProgress.value = `(${i + 1}/${ids.length})`
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
      console.error(storyListFailLog(s?.name || id), e)
    }
  }
  batchActionBusy.value = false
  batchProgress.value = ''
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
    message: `确认终止选中的 ${ids.length} 个虚拟学习者全部未结束的会话（进行中 ${runningSum} + 创建中）？\n会话将被标记为「已放弃」，数据保留，该操作不可撤销。`,
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
    toast.success(terminated > 0 ? `已终止 ${terminated} 个会话（跳过已结束的 ${skipped} 个）` : '没有需要终止的未结束会话')
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
    message: `确认删除选中的 ${ids.length} 个虚拟学习者？\n将一并删除其全部会话、教学记录、学习数据，该操作不可撤销。`,
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
