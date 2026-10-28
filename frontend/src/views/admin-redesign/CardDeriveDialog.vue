<template>
  <!-- 从卡创建虚拟学习者（2026-10-16 用户拍板：卡库=身份池，卡是身份模板、虚拟学习者是由它创建的实例）。
       面板：逐卡列出它的任务（故事池），勾中的任务随身份一起带走；一张卡创建出 1 个虚拟学习者。
       两种打开方式：
       - openWith(profileIds)：卡已选定（卡库单卡 / 批量栏 / 卡详情）；
       - openPicker(cards)：先在本面板选卡（多选），下一步再选任务——虚拟学习者页的主操作
         用它，创建完人留在本页。
       部分失败不整体回滚——按 created/failed 分别汇报，与批量新建「投产半成不报成整单失败」同判例。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="创建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">创建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <!-- 选卡步：只有 openPicker 进来才有 -->
          <template v-if="pickerCards.length">
            <p class="cdd-lead">已选 {{ pickerPicked.length }} 张身份卡</p>
            <ul class="cdd-cards">
              <li v-for="c in pickerCards" :key="c.profileId">
                <label class="mk-field mk-field--switch cdd-card__pick">
                  <input
                    type="checkbox"
                    :checked="pickerPicked.includes(c.profileId)"
                    @change="togglePickCard(c.profileId)"
                  />
                  <span class="cdd-task__title">{{ c.name }}</span>
                </label>
              </li>
            </ul>
          </template>

          <template v-else>
            <p class="cdd-lead">已选 {{ groups.length }} 张身份卡</p>

            <MkLoading v-if="loading" text="读取任务中…" min />
            <MkEmptyState
              v-else-if="error"
              tone="error"
              title="任务读取失败"
              :description="error"
              action-text="重试"
              :action-busy="loading"
              @action="load"
            />

            <template v-else>
              <div v-for="g in groups" :key="g.profileId" class="cdd-group">
                <div class="cdd-group__head">
                  <strong class="cdd-group__name">{{ g.name }}</strong>
                  <span class="cdd-group__meta">{{ pickedCount(g.profileId) }} / {{ g.tasks.length }} 个任务</span>
                </div>
                <p v-if="!g.tasks.length" class="mk-empty--line">这张卡没有任务，无法创建。</p>
                <ul v-else class="cdd-tasks">
                  <li v-for="t in g.tasks" :key="t.id" class="cdd-task">
                    <label class="mk-field mk-field--switch cdd-task__pick">
                      <input
                        type="checkbox"
                        :checked="isPicked(g.profileId, t.id)"
                        @change="toggle(g.profileId, t.id)"
                      />
                      <span class="cdd-task__title">{{ t.title }}</span>
                    </label>
                    <p v-if="t.opening" class="cdd-task__opening">「{{ t.opening }}」</p>
                  </li>
                </ul>
              </div>

              <label class="mk-field">
                <span class="mk-field__label">备注</span>
                <input
                  v-model="note"
                  class="mk-field__input"
                  placeholder="这批虚拟学习者的用途"
                />
              </label>

              <div v-if="failed.length" class="cdd-failed" role="alert">
                <strong>有 {{ failed.length }} 张卡没创建成功</strong>
                <ul>
                  <li v-for="f in failed" :key="f.profileId">{{ f.name }}：{{ f.reason }}</li>
                </ul>
              </div>
            </template>
          </template>
        </div>

        <div class="mk-modal__foot">
          <span class="cdd-foot__note">{{ footNote }}</span>
          <button type="button" class="mk-btn" :disabled="busy" @click="close">取消</button>
          <button
            v-if="pickerCards.length"
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!pickerPicked.length"
            @click="confirmPick"
          >下一步：选任务</button>
          <button
            v-else
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="busy || loading || !derivable.length"
            @click="submit"
          >
            {{ busy ? '创建中…' : `创建 ${derivable.length} 个虚拟学习者` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/** 卡→虚拟学习者创建面板。父组件经 ref 调 openWith(profileIds) / openPicker(cards) 打开；
 *  成功创建后 emit('created', created) 由父组件决定落点（卡库回刷卡墙、列表页回刷并高亮）。 */
import { computed, ref } from 'vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg } from './live'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import { toast } from '@/utils/toast'

interface Task { id: string; title: string; opening: string | null }
interface TaskGroup { profileId: string; name: string; tasks: Task[] }
interface CreatedItem { profileId: string; userId: string; name: string; cardKey: string; taskCount: number }

const emit = defineEmits<{ (e: 'created', created: CreatedItem[]): void }>()

const open = ref(false)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const groups = ref<TaskGroup[]>([])
const failed = ref<Array<{ profileId: string; name: string; reason: string }>>([])
const note = ref('')
/** profileId → 勾中的任务 id（默认全选：一张卡的任务通常都要跑，取消个别才是少数派操作） */
const picked = ref<Record<string, string[]>>({})
/** 选卡步（openPicker 才有）：候选卡 + 已勾的卡 id */
const pickerCards = ref<Array<{ profileId: string; name: string }>>([])
const pickerPicked = ref<string[]>([])

/** 至少留了 1 个任务的卡才会被创建（0 任务的卡后端也会拒，挡在前面省一轮往返） */
const derivable = computed(() => groups.value.filter((g) => pickedCount(g.profileId) > 0))
const footNote = computed(() => (pickerCards.value.length ? '' : derivable.value.length ? '' : '每张卡至少要留下 1 个任务'))

function isPicked(profileId: string, taskId: string): boolean {
  return (picked.value[profileId] || []).includes(taskId)
}
function pickedCount(profileId: string): number {
  return (picked.value[profileId] || []).length
}
function toggle(profileId: string, taskId: string) {
  const cur = picked.value[profileId] || []
  picked.value[profileId] = cur.includes(taskId) ? cur.filter((x) => x !== taskId) : [...cur, taskId]
}
function togglePickCard(profileId: string) {
  const i = pickerPicked.value.indexOf(profileId)
  if (i >= 0) pickerPicked.value.splice(i, 1)
  else pickerPicked.value.push(profileId)
}

async function load() {
  const ids = groups.value.map((g) => g.profileId)
  if (!ids.length) return
  loading.value = true
  error.value = ''
  try {
    const res = await adminVirtualLearnersApi.cardsTasks(ids)
    const d = (res.data?.data ?? res.data) as { groups: TaskGroup[] }
    const next = d?.groups ?? []
    groups.value = next
    // 勾选态按新任务清单重建（重试后任务可能变过，保留旧勾选会创建出对不上的任务）
    const map: Record<string, string[]> = {}
    for (const g of next) map[g.profileId] = g.tasks.map((t) => t.id)
    picked.value = map
  } catch (e) {
    error.value = errMsg(e) || '任务读取失败'
  } finally {
    loading.value = false
  }
}

function openWith(profileIds: string[]) {
  if (!profileIds.length) return
  pickerCards.value = []
  pickerPicked.value = []
  groups.value = profileIds.map((id) => ({ profileId: id, name: id, tasks: [] }))
  failed.value = []
  note.value = ''
  open.value = true
  void load()
}

/** 选卡 → 选任务：候选卡一次给全，勾中的卡进入下一步 */
function openPicker(cards: Array<{ profileId: string; name: string }>) {
  if (!cards.length) return
  pickerCards.value = cards
  pickerPicked.value = []
  groups.value = []
  failed.value = []
  note.value = ''
  open.value = true
}

function confirmPick() {
  if (!pickerPicked.value.length) return
  openWith([...pickerPicked.value])
}

function close() {
  if (busy.value) return
  open.value = false
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

async function submit() {
  const items = derivable.value.map((g) => ({ profileId: g.profileId, storyIds: picked.value[g.profileId] || [] }))
  if (!items.length) return
  busy.value = true
  failed.value = []
  try {
    const res = await adminVirtualLearnersApi.cardsClone(items, note.value.trim() || undefined)
    const d = (res.data?.data ?? res.data) as { created: CreatedItem[]; failed: Array<{ profileId: string; reason: string }> }
    const created = d?.created ?? []
    const rawFailed = d?.failed ?? []
    const nameOf = (pid: string) => groups.value.find((g) => g.profileId === pid)?.name || pid
    if (created.length) {
      emit('created', created)
    }
    if (rawFailed.length) {
      // 失败逐条留面板内（toast 一闪而过，哪张卡为什么失败要说清楚）
      failed.value = rawFailed.map((f) => ({ profileId: f.profileId, name: nameOf(f.profileId), reason: f.reason }))
      const kept = new Set(rawFailed.map((f) => f.profileId))
      groups.value = groups.value.filter((g) => kept.has(g.profileId))
    } else {
      open.value = false
    }
  } catch (e) {
    toast.error(errMsg(e) || '创建失败')
  } finally {
    busy.value = false
  }
}

defineExpose({ openWith, openPicker })
</script>

<style scoped>
.cdd-lead {
  margin: 0 0 4px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.6;
}
.cdd-group {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface-2);
}
.cdd-group__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.cdd-group__name { font-size: var(--mk-fs-body); color: var(--mk-ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdd-group__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); flex: none; }
.cdd-tasks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.cdd-task { display: grid; gap: 2px; min-width: 0; }
.cdd-task__pick { align-items: flex-start; }
.cdd-task__pick input[type='checkbox'] { accent-color: var(--mk-blue, #2f6ae0); cursor: pointer; margin-top: 2px; flex: none; }
.cdd-task__title { font-size: var(--mk-fs-body); color: var(--mk-ink); line-height: 1.5; min-width: 0; }
.cdd-task__opening { margin: 0; padding-left: 26px; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.cdd-failed { padding: 10px 12px; border-radius: var(--mk-radius-lg); background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); font-size: var(--mk-fs-micro); }
.cdd-failed ul { margin: 4px 0 0; padding-left: 18px; }
.cdd-foot__note { font-size: var(--mk-fs-micro); color: var(--mk-muted); margin-right: auto; }
.cdd-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 320px; overflow-y: auto; }
.cdd-card__pick { align-items: flex-start; }
.cdd-card__pick input[type='checkbox'] { accent-color: var(--mk-blue, #2f6ae0); cursor: pointer; margin-top: 2px; flex: none; }
</style>
