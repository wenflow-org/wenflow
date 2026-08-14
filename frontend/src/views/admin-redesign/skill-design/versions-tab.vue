<template>
  <!-- 版本：核心文件版本（协议发布） + Prompt 版本（单一入口，原协议 pill 已并入） -->
  <div class="sdp-versions">
    <section class="sdp-eng">
      <header class="sdp-sec-head">
        <h4>核心文件版本（协议发布）</h4>
        <span class="sdp-sec-meta">{{ coreVersions.length }} 个 · 回滚会替换磁盘文件与 ACTIVE</span>
      </header>
      <div class="mk-table-wrap">
        <table class="sdp-pw__table">
          <thead>
            <tr><th>版本</th><th>coreHash</th><th>coreVer</th><th>状态</th><th>发布者</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="v in coreVersions" :key="v.version" :class="{ 'sdp-pw__table-active': v.status === 'ACTIVE' }">
              <td class="mono">v{{ v.version }}</td>
              <td class="mono" :title="v.coreHash ?? undefined">{{ coreShortHash(v.coreHash) }}</td>
              <td class="mono">{{ v.coreVersion ?? '—' }}</td>
              <td>{{ v.status }}</td>
              <td>{{ v.createdBy }}</td>
              <td>
                <button
                  v-if="v.status !== 'ACTIVE' && v.rollbackable"
                  type="button"
                  class="mk-link"
                  :disabled="coreRollbacking"
                  @click="rollbackCore(v.version)"
                >回滚</button>
                <span v-else-if="v.status !== 'ACTIVE'" class="sdp-pw__audit" title="该历史版本没有可验证的 core 快照，只保留审计用途">仅审计</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!coreVersionsLoading && !coreVersions.length" class="sdp-none">暂无核心文件版本记录</p>
    </section>

    <section class="sdp-eng">
      <header class="sdp-sec-head">
        <h4>Prompt 版本</h4>
        <span class="sdp-sec-meta">{{ promptVersions.length }} 个版本</span>
      </header>
      <p v-if="versionMsg" class="sdp-versions-msg" :class="{ 'is-err': versionErr }">{{ versionMsg }}</p>
      <div class="mk-table-wrap">
        <table class="mk-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>名称</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in promptVersions" :key="v.id">
              <td><span class="sdp-vtag mono">v{{ v.version }}</span></td>
              <td>
                <span class="mk-badge" :class="v.status === 'ACTIVE' ? 'mk-badge--ok' : 'mk-badge--muted'">{{ v.status }}</span>
              </td>
              <td><span class="sdp-vname" :title="v.name">{{ v.name || '—' }}</span></td>
              <td>
                <div class="mk-actions">
                  <button
                    v-if="v.status !== 'ACTIVE'"
                    type="button"
                    class="mk-link"
                    :disabled="versionBusy === v.id"
                    @click="compareWithActive(v)"
                  >
                    {{ compareLoading === v.id ? '对比中…' : '对比生效版' }}
                  </button>
                  <span v-if="v.status === 'ACTIVE'" class="mk-na">当前生效</span>
                </div>
              </td>
            </tr>
            <tr v-if="!promptVersions.length">
              <td colspan="4"><span class="mk-na">暂无版本记录</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 对比结果 -->
      <div v-if="compareResult" class="sdp-diff">
        <div class="sdp-diff__head">
          <span class="mono">{{ compareResult.aLabel }} ↔ {{ compareResult.bLabel }}</span>
          <span class="sdp-diff__count" :class="{ 'is-clean': compareResult.changedLines === 0 }">
            {{ compareResult.changedLines ? `${compareResult.changedLines} 行变更` : '内容一致' }}
          </span>
          <button type="button" class="mk-link" @click="compareResult = null">收起</button>
        </div>
        <div class="sdp-diff__body mono">
          <template v-for="(grp, gi) in compareResult.groups" :key="gi">
            <div v-if="grp.gap" class="sdp-diff__gap">…</div>
            <div v-for="(line, li) in grp.lines" :key="li" class="sdp-diff__line" :class="`is-${line.type}`">
              <span class="sdp-diff__no">{{ line.no }}</span>
              <span class="sdp-diff__text">{{ line.text }}</span>
            </div>
          </template>
          <p v-if="!compareResult.groups.length && compareResult.changedLines === 0" class="sdp-diff__same">两版本内容完全一致。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 版本 tab（单一版本入口）：顶层版本 tab 吸收原「协议·版本历史」pill，
 * 双份版本数据按「核心文件版本（协议发布） / Prompt 版本」分区展示。
 */
import { ref, watch } from 'vue'
import { adminAgentPromptsApi, adminPromptWorkbenchApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { toast } from '@/utils/toast'
import { coreShortHash, errText } from './sdp-shared'

const props = defineProps<{ skillId: string; refreshTick: number }>()
const emit = defineEmits<{ (e: 'core-rolled-back'): void }>()

/* ---------- Prompt 版本 ---------- */
interface VersionItem { id: string; version: string | number; status: string; name: string }
const promptVersions = ref<VersionItem[]>([])
const versionBusy = ref('')
const compareLoading = ref('')
const versionMsg = ref('')
const versionErr = ref(false)
interface DiffLine { type: 'added' | 'removed'; no: number | string; text: string }
interface DiffGroup { gap: boolean; lines: DiffLine[] }
const compareResult = ref<{ aLabel: string; bLabel: string; changedLines: number; groups: DiffGroup[] } | null>(null)

async function loadVersions() {
  const id = props.skillId
  const res = await adminAgentPromptsApi.getPromptVersions({ agentId: `skill:${id}` }).catch(() => null)
  if (id !== props.skillId) return
  const body = res?.data?.data ?? res?.data ?? []
  const items = Array.isArray(body) ? body : body.list || body.items || body.versions || []
  // ACTIVE 优先排前，避免切片后「对比生效版」误报没有生效版本
  const sorted = [...(items as Array<Record<string, unknown>>)].sort(
    (a, b) => Number(String(b.status === 'ACTIVE')) - Number(String(a.status === 'ACTIVE'))
  )
  promptVersions.value = sorted.slice(0, 12).map((v: Record<string, unknown>) => ({
    id: String(v.id || ''),
    version: (v.version as string | number) ?? '—',
    status: String(v.status || '—'),
    name: String(v.name || '')
  }))
}

async function compareWithActive(v: VersionItem) {
  const active = promptVersions.value.find((x) => x.status === 'ACTIVE')
  if (!active) {
    versionMsg.value = '当前没有生效版本可作对比基准'
    versionErr.value = true
    return
  }
  if (compareLoading.value) return
  compareLoading.value = v.id
  versionMsg.value = ''
  versionErr.value = false
  try {
    const res = await adminAgentPromptsApi.comparePrompts(active.id, v.id)
    const d = res.data?.data ?? res.data ?? {}
    const diffs = (d.diffs || []) as Array<Record<string, unknown>>
    const groups: DiffGroup[] = []
    let current: DiffLine[] = []
    const flush = () => {
      if (current.length) {
        groups.push({ gap: groups.length > 0, lines: current })
        current = []
      }
    }
    for (const row of diffs) {
      const type = String(row.type)
      if (type === 'same') {
        flush()
        continue
      }
      if (type === 'added') current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      else if (type === 'removed') current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
      else if (type === 'modified') {
        current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
        current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      }
      if (current.length >= 300) {
        flush()
        break
      }
    }
    flush()
    compareResult.value = {
      aLabel: `v${active.version}（生效）`,
      bLabel: `v${v.version}`,
      changedLines: Number(d.changedLines || 0),
      groups
    }
  } catch (e) {
    versionMsg.value = `对比失败：${errText(e)}`
    versionErr.value = true
  } finally {
    compareLoading.value = ''
  }
}

/* ---------- 核心文件版本（原协议·版本历史 pill，并入顶层版本 tab） ---------- */
interface CoreVersionRow {
  version: number; status: string; coreHash: string | null; coreVersion: number | null
  createdBy: string; publishedAt: string | null; rollbackable: boolean
}
const coreVersions = ref<CoreVersionRow[]>([])
const coreVersionsLoading = ref(false)
const coreRollbacking = ref(false)

async function loadCoreVersions() {
  const id = props.skillId
  coreVersionsLoading.value = true
  try {
    const res = await adminPromptWorkbenchApi.getCoreVersions(id)
    if (id !== props.skillId) return
    coreVersions.value = res.data?.versions || []
  } catch (e) {
    if (id !== props.skillId) return
    toast.error(`版本加载失败：${errText(e)}`)
  } finally {
    if (id === props.skillId) coreVersionsLoading.value = false
  }
}

async function rollbackCore(version: number) {
  if (coreRollbacking.value) return
  const ok = await askConfirm({
    title: '回滚版本',
    message: `确认回滚 ${props.skillId} 到 v${version}？\n现行文件与 ACTIVE 将被替换。`,
    confirmText: '回滚'
  })
  if (!ok) return
  coreRollbacking.value = true
  try {
    await adminPromptWorkbenchApi.rollbackCore(props.skillId, version)
    toast.success(`已回滚到 v${version}`)
    // 回滚替换了磁盘文件：通知主页面重拉协议编辑器与 overview
    emit('core-rolled-back')
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string } } })?.response?.data
    toast.error(data?.error || `回滚失败：${errText(e)}`)
  } finally {
    coreRollbacking.value = false
  }
}

/* 切换 skill / 发布 / 回滚后刷新 */
watch(
  [() => props.skillId, () => props.refreshTick],
  () => {
    compareResult.value = null
    void Promise.all([loadVersions(), loadCoreVersions()])
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- 版本 ---------- */
.sdp-versions { display: grid; gap: 16px; }
.sdp-versions-msg { margin: 0; font-size: 11.5px; color: var(--mk-green); font-weight: 600; display: flex; gap: 8px; align-items: center; }
.sdp-versions-msg.is-err { color: var(--mk-red); }
.mk-table-wrap {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow-x: auto;
  background: #fff;
}
.sdp-vtag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: #eef2fa;
  color: #41516e;
  font-size: 10.5px;
}
/* Prompt 版本名称列：上限 420px（原 656px 占半屏无上限）+ ellipsis + title 全值 */
.sdp-vname {
  display: inline-block;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  color: var(--mk-muted);
}
.sdp-diff {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.sdp-diff__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafd;
  border-bottom: 1px solid #eef2f8;
  font-size: 11px;
  color: var(--mk-muted);
}
.sdp-diff__count { font-weight: 700; color: var(--mk-amber); }
.sdp-diff__count.is-clean { color: var(--mk-green); }
.sdp-diff__head .mk-link { margin-left: auto; }
.sdp-diff__body {
  max-height: 380px;
  overflow-y: auto;
  padding: 6px 0;
  font-size: 10.5px;
  line-height: 1.6;
}
.sdp-diff__line {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 8px;
  padding: 1px 12px;
}
.sdp-diff__line.is-added { background: var(--mk-green-bg); }
.sdp-diff__line.is-added .sdp-diff__text { color: var(--mk-green); }
.sdp-diff__line.is-added .sdp-diff__no::after { content: '+'; color: var(--mk-green); margin-left: 3px; }
.sdp-diff__line.is-removed { background: var(--mk-red-bg); }
.sdp-diff__line.is-removed .sdp-diff__text { color: var(--mk-red-strong); }
.sdp-diff__line.is-removed .sdp-diff__no::after { content: '−'; color: var(--mk-red-strong); margin-left: 3px; }
.sdp-diff__no { color: var(--mk-faint); text-align: right; user-select: none; }
.sdp-diff__text { white-space: pre-wrap; word-break: break-word; color: #41516e; }
.sdp-diff__gap { padding: 2px 12px; color: #c3cede; user-select: none; }
.sdp-diff__same { margin: 8px 12px; font-size: 11px; color: var(--mk-faint); }

/* 核心文件版本表（沿用协议 tab 原 sdp-pw__table 视觉） */
.sdp-pw__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sdp-pw__table th, .sdp-pw__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #f0f2f5;
}
.sdp-pw__table-active { background: var(--mk-green-bg); }
.sdp-pw__audit { font-size: 11px; color: var(--mk-faint); }

/* 分区头 */
.sdp-eng { display: grid; gap: 8px; }
.sdp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sdp-sec-head h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.sdp-sec-meta { font-size: 11px; color: var(--mk-faint); display: inline-flex; gap: 10px; align-items: center; }
.sdp-none { margin: 0; font-size: 12px; color: var(--mk-faint); }

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-sec-head h4 { font-size: 17.5px; }
  .sdp-sec-meta { font-size: 17.5px; }
  .sdp-versions-msg { font-size: 18px; }
  .sdp-vtag { font-size: 16.5px; padding: 2px 9px; }
  .sdp-diff__head { font-size: 17.5px; padding: 12px 16px; }
  .sdp-diff__body { font-size: 16.5px; max-height: 460px; }
  .sdp-diff__same { font-size: 17.5px; }
  .sdp-pw__table { font-size: 18px; }
  .sdp-pw__audit { font-size: 17.5px; }
}
</style>
