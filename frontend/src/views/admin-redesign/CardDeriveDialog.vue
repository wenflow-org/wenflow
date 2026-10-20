<template>
  <!-- 从卡创建虚拟学习者（2026-10-16 用户拍板：卡库=身份池，卡是身份模板、虚拟学习者是由它创建的实例）。
       面板：逐卡列出它的任务（故事池），勾中的任务随身份一起带走；一张卡创建出 1 个虚拟学习者。
       部分失败不整体回滚——按 created/failed 分别汇报，与批量新建「投产半成不报成整单失败」同判例。 -->
  <Teleport v-if="open" to="body">
    <div class="mk-modal">
      <div class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="从卡创建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">创建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <p class="cdd-lead">
            已选 {{ groups.length }} 张身份卡 · 每张卡创建 1 个虚拟学习者
          </p>

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
        </div>

        <div class="mk-modal__foot">
          <span class="cdd-foot__note">{{ derivable.length ? '' : '每张卡至少要留下 1 个任务' }}</span>
          <button type="button" class="mk-btn" :disabled="busy" @click="close">取消</button>
          <button
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
/** 卡→虚拟学习者创建面板。父组件经 ref 调 open(profileIds) 打开；成功创建后 emit('created', ...)。 */
import { computed, onBeforeUnmount, ref } from 'vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg } from './live'
import { toast } from '@/utils/toast'

interface Task { id: string; title: string; opening: string | null }
interface TaskGroup { profileId: string; name: string; tasks: Task[] }
interface CreatedItem { profileId: string; userId: string; name: string; cardKey: string; taskCount: number }

const emit = defineEmits<{ (e: 'created', created: CreatedItem[]): void }>()

const open = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const groups = ref<TaskGroup[]>([])
const failed = ref<Array<{ profileId: string; name: string; reason: string }>>([])
const note = ref('')
/** profileId → 勾中的任务 id（默认全选：一张卡的任务通常都要跑，取消个别才是少数派操作） */
const picked = ref<Record<string, string[]>>({})

/** 至少留了 1 个任务的卡才会被创建（0 任务的卡后端也会拒，挡在前面省一轮往返） */
const derivable = computed(() => groups.value.filter((g) => pickedCount(g.profileId) > 0))

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
  groups.value = profileIds.map((id) => ({ profileId: id, name: id, tasks: [] }))
  failed.value = []
  note.value = ''
  open.value = true
  window.addEventListener('keydown', onKey)
  void load()
}

function close() {
  if (busy.value) return
  open.value = false
  window.removeEventListener('keydown', onKey)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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
      toast.success(`已创建 ${created.length} 个虚拟学习者`)
      emit('created', created)
    }
    if (rawFailed.length) {
      // 失败逐条留面板内（toast 一闪而过，哪张卡为什么失败要说清楚）
      failed.value = rawFailed.map((f) => ({ profileId: f.profileId, name: nameOf(f.profileId), reason: f.reason }))
      const kept = new Set(rawFailed.map((f) => f.profileId))
      groups.value = groups.value.filter((g) => kept.has(g.profileId))
    } else {
      open.value = false
      window.removeEventListener('keydown', onKey)
    }
  } catch (e) {
    toast.error(errMsg(e) || '创建失败')
  } finally {
    busy.value = false
  }
}

defineExpose({ openWith })
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
</style>
