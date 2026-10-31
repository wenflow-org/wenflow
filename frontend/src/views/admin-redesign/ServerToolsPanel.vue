<template>
  <!-- 运维工具面板（原「系统工具」页 Tab1；2026-10-16 用户拍板该场景解散并入运营中心：
       本组件作为运营中心宿主的一个页签体渲染，id/role=tabpanel/aria-labelledby 由宿主透传落到本根节点）。
       2026-10-28：只保留「事件投递失败」——后台任务没送达时的重发入口；
       时间推进 / 内容抽检退役，批量吞吐迁到「模型与接入」。 -->
  <div class="stp-body">
    <!-- Outbox 死信：运营待办「事件投递失败 → 去处理」落在这里。
         2026-10-27 重做：零死信不再是一张「空表格 + 禁用按钮」，改为健康态摘要；
         有积压时卡头才出现重发主操作，正文补一条副作用提醒。 -->
    <section class="mk-card stp-card">
      <div class="mk-card__head">
        <div class="stp-head">
          <h4 class="mk-card__title">事件投递失败</h4>
          <!-- 死信告警（原状态条语义迁入卡头）：失败显式降 bad，积压 >0 显式 warn，
               零值只有成功加载后才显示「全部已送达」——加载中不得伪装成确认无死信 -->
          <span v-if="deadFailed" class="mk-badge mk-badge--bad">加载失败</span>
          <span v-else-if="!deadLoading && deadCount > 0" class="mk-badge mk-badge--warn">{{ deadCount }} 条待重发</span>
          <span v-else-if="deadLoaded" class="mk-badge mk-badge--ok">全部已送达</span>
        </div>
        <div class="mk-card__head-right">
          <!-- 空态不给假动作：0 死信时不渲染重发钮；加载失败时作用域未知，也不给 -->
          <button
            v-if="!deadFailed && deadCount > 0"
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="requeueBusy || deadLoading"
            @click="requeueAll"
          >
            {{ requeueBusy ? '重发中…' : '重新发送全部' }}
          </button>
        </div>
      </div>
      <p class="stp-intro">后台任务（更新学习画像、发放成就等）第一次投递失败会记在这里，确认根因修复后可重发。</p>

      <MkLoading v-if="deadLoading" />
      <MkEmptyState
        v-else-if="deadFailed"
        tone="error"
        icon="!"
        title="事件清单加载失败"
        action-text="重试"
        compact
        @action="loadDead"
      />
      <template v-else-if="deadItems.length">
        <p class="stp-warn">
          <TriangleAlert :size="15" :stroke-width="2" aria-hidden="true" />
          重发会再次执行对应业务动作，可能产生重复副作用。请先确认根因已修复。
        </p>
        <div class="mk-table-scroll">
          <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed，2026-10-01 对齐 Users 判例），
               单元格 nowrap、列按内容自然分宽；事件类型 / 错误信息两处长内容列 max-width 截断兜底 -->
          <table class="mk-table mk-table--nowrap stp-dead-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>用户</th>
                <th>关联对象</th>
                <th class="mk-th--right">已试</th>
                <th>最后一次错误</th>
                <th>发生时间</th>
                <th class="mk-th--right mk-c-act">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in deadItems" :key="item.id">
                <td><span class="mono stp-ev" :title="item.eventType">{{ item.eventType }}</span></td>
                <td>
                  <span v-if="item.userId" class="mono mk-cell-text">{{ shortId(item.userId, 10, 4) }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <td>
                  <span v-if="item.aggregateId" class="mono mk-cell-text" :title="item.aggregateId">{{ shortId(item.aggregateId, 10, 4) }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <td class="mk-num">{{ item.attemptCount }}</td>
                <td>
                  <span v-if="item.lastError" class="stp-err" :title="item.lastError">{{ item.lastError }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <td :title="fmtDate(item.occurredAt)">{{ timeAgo(item.occurredAt) }}</td>
                <td>
                  <div class="mk-actions">
                    <button type="button" class="mk-btn mk-btn--sm" :disabled="requeueBusy" @click="requeueOne(item.eventType)">重发这类</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mk-list-more">
          <!-- CP8：死信总条数由卡头 warn 徽标单源承载，列表尾不再复读「共 N 条死信」。
               口径与后端一致（outbox.worker 按 occurredAt 升序 take 50 → 实为最早 50 条，
               不是「最近」）；总数一并给出，避免把窗口读成全量 -->
          <span>最早 50 条（共 {{ deadCount }} 条）</span>
          <button type="button" class="mk-link" @click="loadDead">刷新</button>
        </div>
      </template>
      <!-- 计数 > 0 但窗口没返回行：如实说窗口为空，不冒充「全部送达」 -->
      <MkEmptyState
        v-else-if="deadCount > 0"
        title="当前窗口没有返回失败记录"
        :description="`共 ${deadCount} 条待重发，刷新后再看。`"
        action-text="刷新"
        compact
        @action="loadDead"
      />
      <!-- 健康态：不是「空表格」，而是一句可确认的结论 + 一条刷新出口 -->
      <div v-else class="stp-ok">
        <span class="stp-ok__icon" aria-hidden="true">
          <CircleCheck :size="22" :stroke-width="1.9" />
        </span>
        <div class="stp-ok__text">
          <strong>没有投递失败的事件</strong>
          <span>学习画像更新、成就发放等后台任务都已正常送达。</span>
        </div>
        <button type="button" class="mk-link stp-ok__refresh" @click="loadDead">刷新</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { askConfirm } from './useConfirm'
import { adminDevtoolsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import { CircleCheck, TriangleAlert } from 'lucide-vue-next'

/* 运维工具（原「系统工具」页 Tab1 整体迁入，2026-10-16）：现在只剩「事件投递失败」的重发入口。
   时间推进（虚拟学习者仿真）、内容抽检（已下线）已退役，批量吞吐迁到「模型与接入」。 */

const requeueBusy = ref(false)

/* 死信 */
/** 死信行结构：镜像 adminApi.ts getOutboxDead 泛型内联类型（api 侧未导出，只能就地声明） */
interface OutboxDeadItem {
  id: string
  eventType: string
  userId: string | null
  aggregateId: string | null
  attemptCount: number
  lastError: string | null
  occurredAt: string
}
const deadCount = ref(0)
const deadItems = ref<OutboxDeadItem[]>([])
const deadLoading = ref(false)
const deadFailed = ref(false)
const deadLoaded = ref(false)

async function loadDead() {
  deadLoading.value = true
  deadFailed.value = false
  try {
    const res = await adminDevtoolsApi.getOutboxDead()
    const data = res.data?.data ?? res.data
    deadCount.value = Number(data?.deadCount || 0)
    deadItems.value = Array.isArray(data?.items) ? data.items : []
    deadLoaded.value = true
  } catch (e) {
    deadFailed.value = true
    toast.error(`事件清单加载失败：${errMsg(e)}`)
  } finally {
    deadLoading.value = false
  }
}

async function requeueAll() {
  // 重发会重新投递事件、产生真实副作用：执行前确认（与 HealthCenter 修复/会话下线同策略）
  const ok = await askConfirm({
    title: '重新发送全部失败事件',
    message: `将把全部 ${deadCount.value} 条投递失败的事件再发送一次，可能产生重复的业务副作用。确定继续？`,
    confirmText: '全部重发',
    danger: true,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead()
    const data = res.data?.data ?? res.data
    toast.success(`已重新发送 ${data?.requeued ?? 0} 条事件`)
    void loadDead()
  } catch (e) {
    const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
    if (code === 'OUTBOX_DEAD_LETTER_ROOT_CAUSE') {
      const force = await askConfirm({
        title: '存在已知根因的失败事件',
        message: '这些事件带有已知根因（如非法 FSRS 状态），直接重发会再次失败。确认根因已修复后，仍要强制重发吗？',
        confirmText: '强制重发',
        danger: true,
      })
      if (force) {
        try {
          const forced = await adminDevtoolsApi.requeueOutboxDead(undefined, true)
          const data = forced.data?.data ?? forced.data
          toast.success(`已强制重发 ${data?.requeued ?? 0} 条事件`)
          void loadDead()
          return
        } catch (forceError) {
          toast.error(`强制重发失败：${errMsg(forceError)}`)
          return
        }
      }
    }
    toast.error(`重新发送失败：${errMsg(e)}`)
  } finally {
    requeueBusy.value = false
  }
}

/** 注意：后端按事件类型重发（非单条），按钮与确认文案均需明确「该类型全部」范围 */
async function requeueOne(eventType: string) {
  const count = deadItems.value.filter((i) => i.eventType === eventType).length
  const ok = await askConfirm({
    title: '重新发送这类事件',
    message: `将把「${eventType}」类全部投递失败的事件再发送一次（当前清单内 ${count} 条），可能产生重复的业务副作用。确定继续？`,
    confirmText: '重发这类',
    danger: true,
  })
  if (!ok) return
  requeueBusy.value = true
  try {
    const res = await adminDevtoolsApi.requeueOutboxDead(eventType)
    const data = res.data?.data ?? res.data
    toast.success(`已重新发送 ${data?.requeued ?? 0} 条「${eventType}」事件`)
    void loadDead()
  } catch (e) {
    toast.error(`重新发送失败：${errMsg(e)}`)
  } finally {
    requeueBusy.value = false
  }
}

/** 宿主刷新钮调用的整体重载：只重拉死信清单 */
async function refresh() {
  await loadDead()
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* 死信懒加载：与页签同生共死（宿主 v-if 挂载本组件时才拉），故挂载即拉一次 */
onMounted(() => {
  void loadDead()
})

/** 宿主可调（刷新钮）；暴露 loadDead 供外部触发重拉 */
defineExpose({ refresh, reload: loadDead })
</script>

<style scoped>
.stp-body {
  padding: 16px;
  display: grid;
  gap: 12px;
  align-content: start;
}
/* 工具卡的用途说明（2026-10-28 用户「写法理解成本比较高」）：
   用运营能看懂的话讲清「这些记录从哪来、点按钮会发生什么」。 */
.stp-intro {
  margin: -2px 16px 12px;
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  color: var(--mk-muted);
}
/* 卡头左组：标题 + 状态徽标同一行 */
.stp-head { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }

/* 有积压时的副作用提醒：重发会产生真实业务动作，提醒必须成条出现 */
.stp-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 16px 12px;
  padding: 8px 12px;
  border-radius: var(--mk-radius-md);
  background: color-mix(in srgb, var(--mk-amber) 9%, transparent);
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}
.stp-warn svg { flex: none; margin-top: 1px; color: var(--mk-amber); }

/* 健康态：一句可确认的结论 + 一句范围说明 + 刷新出口，替代「空表格里放一句没有数据」 */
.stp-ok {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 16px 16px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--mk-green) 22%, var(--mk-line));
  border-radius: var(--mk-radius-md);
  background: color-mix(in srgb, var(--mk-green) 7%, var(--mk-surface));
}
.stp-ok__icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mk-green) 14%, transparent);
  color: var(--mk-green);
}
.stp-ok__text { display: grid; gap: 2px; min-width: 0; flex: 1 1 auto; }
.stp-ok__text strong { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.stp-ok__text span { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.stp-ok__refresh { flex: none; }
/* 死信表（自动布局）：事件类型长名截断（title 全值）。nowrap 走表级 .mk-table--nowrap */
.stp-ev {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.stp-err {
  display: inline-block;
  /* 自动布局下 max-content 决定列宽：固定截断上限，长错误信息不独吃表格宽度（title 全值） */
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
}
</style>
