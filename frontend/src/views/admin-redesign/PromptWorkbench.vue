<template>
  <div :class="{ 'mk-page': !embedded }">
    <!-- 状态条（嵌入编排图时隐藏，编排页已有自己的状态栏） -->
    <div v-if="!embedded" class="mk-status" :class="cores.some((c) => c.status === 'pending-compile') ? 'mk-status--warn' : cores.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Skill 工作台</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">核心文件 {{ cores.length }}</span>
      <span class="mk-status__meta pw-ok">同步 {{ countBy('synced') }}</span>
      <span class="mk-status__meta pw-warn">待编译发布 {{ countBy('pending-compile') }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadList">
          <MkLoading v-if="loading" inline text="刷新中…" /><span v-else>刷新</span>
        </button>
      </span>
    </div>

    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">核心文件</h3>
        <span class="mk-card__meta">编辑与发布在 Skill 设计页「协议」页签；从 0 新建不在管理台——走 CLI（backend/scripts/scaffold-skill.ts，见 doc/SKILL_DEVELOPMENT_GUIDE.md）</span>
      </div>
      <div class="mk-table-scroll">
      <!-- 首载骨架屏（对齐全站「骨架替代空白」约定；此前整表无占位） -->
      <MockSkeletonTable v-if="loading && !cores.length" :cols="6" :rows="8" />
      <table v-else-if="cores.length" class="mk-table mk-table--click mk-table--fixed">
        <colgroup>
          <col style="width:var(--mk-col-text)">
          <col style="width:var(--mk-col-badge)">
          <col style="width:var(--mk-col-badge)">
          <col style="width:var(--mk-col-model)">
          <col style="width:var(--mk-col-badge)">
          <col style="width:var(--mk-col-actions)">
        </colgroup>
        <thead>
          <tr>
            <th>Skill</th>
            <th>结构</th>
            <th>输出</th>
            <th title="coreHash">核心哈希</th>
            <th>状态</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in shownCores" :key="item.skillId" @click="openDesign(item.skillId)">
            <td><code class="mono">{{ item.skillId }}</code></td>
            <td class="mk-na">{{ item.fields }} 字段 · {{ item.channels.length }} 通道</td>
            <td class="mk-na">{{ item.outputMedia }}<template v-if="item.deltaOutput"> · delta</template></td>
            <td><code class="mono pw-hash" :title="item.coreHash">{{ shortHash(item.coreHash) }}</code></td>
            <td>
              <span class="mk-badge" :class="statusBadge(item.status)">{{ statusLabel(item.status) }}</span>
            </td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click.stop="openDesign(item.skillId)">协议 / 发布 →</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="canMoreCores" class="mk-list-more">
        <button type="button" class="mk-link" @click="loadMoreCores">
          加载更多（已显示 {{ shownCores.length }} / {{ cores.length }}）
        </button>
      </div>
      <MkEmptyState
        v-if="!cores.length && !loading"
        :icon="loadError ? '' : '◌'"
        :title="loadError ? '清单加载失败' : '未发现核心文件'"
        :description="loadError || '编辑与发布入口在 Skill 设计页的「协议」页签。'"
        :action-text="loadError ? '重试' : ''"
        @action="loadList"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
defineProps<{ embedded?: boolean }>()
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminPromptWorkbenchApi } from '@/api/adminApi';
import { useLoadMore } from './useLoadMore';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';
import { errMsg } from './live'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue';

interface CoreListItem {
  skillId: string;
  fields: number;
  channels: string[];
  stateAdvance: boolean;
  deltaOutput: boolean;
  outputMedia: string;
  coreHash: string;
  publishedHash: string | null;
  status: 'synced' | 'pending-compile' | 'no-prompt';
}

const router = useRouter();
const cores = ref<CoreListItem[]>([]);
const loading = ref(false);
const loadError = ref('');

/* 滚动修复 #8：核心文件表 15 行/页（客户端切片，加载更多翻页） */
const { shown: shownCores, canMore: canMoreCores, loadMore: loadMoreCores } = useLoadMore(computed(() => cores.value), 15);

function countBy(status: string) {
  return cores.value.filter((c) => c.status === status).length;
}

function shortHash(hash?: string | null) {
  return hash ? `${hash.slice(0, 10)}…` : '—';
}

function statusLabel(status: string) {
  if (status === 'synced') return '已同步';
  if (status === 'pending-compile') return '待编译发布';
  return '无 Prompt';
}

function statusBadge(status: string) {
  if (status === 'synced') return 'mk-badge--ok';
  if (status === 'pending-compile') return 'mk-badge--warn';
  return 'mk-badge--muted';
}

/** 编辑统一入口：Skill 设计页「协议」页签 */
function openDesign(skillId: string) {
  void router.push(`/admin/skills/${encodeURIComponent(skillId)}?tab=protocol`);
}

async function loadList() {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await adminPromptWorkbenchApi.getCoreList();
    cores.value = res.data?.items || [];
  } catch (e) {
    /* 错误人话化走全站单源 errMsg（此前直抛 e.message，管理员会看到
       "Request failed with status code 500" 之类的原始英文） */
    cores.value = [];
    loadError.value = `清单加载失败：${errMsg(e)}`;
    toast.error(loadError.value);
  } finally {
    loading.value = false;
  }
}

// ============ 新建 Skill（scaffold）已迁出管理台 ============
// 定位收敛（2026-09 拍板）：管理台只做轻运营调整（改已有 prompt/参数/发布/回滚/试跑）；
// 从 0 新建是代码级动作（scaffold 只出片段，还需 manifest/skills/index.ts/coordinator
// 三处手工接线），统一走 CLI：backend/scripts/scaffold-skill.ts（同一服务层 scaffoldSkill）。

onMounted(async () => {
  await loadList();
});
</script>

<style scoped>
.pw-ok { color: var(--mk-green, #15803d); }
.pw-warn { color: var(--mk-amber, #b45309); }
.pw-hash { font-size: var(--mk-fs-micro); }
.mk-table--click tbody tr { cursor: pointer; }
.sc-result__section { margin-top: 14px; }.sc-result__title { display: block; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted, #5b6577); margin-bottom: 6px; }
.sc-result__files { margin: 0; padding-left: 18px; }
.sc-result__files li { font-size: var(--mk-fs-micro); color: var(--mk-blue, #2c63d0); line-height: 1.8; }
.sc-result__snippets { margin-top: 14px; border-top: 1px solid var(--mk-line, #e6ebf4); padding-top: 10px; }
.sc-form { display: flex; flex-direction: column; gap: 12px; }
.sc-field { display: flex; flex-direction: column; gap: 5px; }
.sc-field__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted, #5b6577); }
.sc-field__label em { color: var(--mk-red, #dc2626); font-style: normal; }
.sc-field__input {
  padding: 8px 11px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-xl);
  background: #fbfcfe;
  color: var(--mk-ink, #1a2a44);
  font: inherit;
  font-size: var(--mk-fs-micro);
  outline: none;
}
.sc-field__input:focus { border-color: var(--mk-blue, #2c63d0); }
.sc-field__textarea { resize: vertical; min-height: 44px; line-height: 1.55; }
.sc-msg {
  margin: 10px 0 0;
  padding: 9px 12px;
  border: 1px solid rgba(44, 99, 208, 0.35);
  border-radius: var(--mk-radius-xl);
  background: #f0f5ff;
  color: var(--mk-blue, #2c63d0);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.sc-msg--error { border-color: rgba(220, 38, 38, 0.4); background: #fef2f2; color: var(--mk-red, #dc2626); }

.sc-result__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-result__id { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink, #1a2a44); }
.sc-badge-kind { background: #eef2fa; color: var(--mk-muted, #5b6577); }
.sc-result__note {
  margin: 10px 0 0;
  padding: 8px 12px;
  border: 1px dashed rgba(180, 83, 9, 0.45);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  color: var(--mk-amber, #b45309);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.55;
}
.sc-result__section { margin-top: 14px; }
.sc-result__title { display: block; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted, #5b6577); margin-bottom: 6px; }
.sc-result__files { margin: 0; padding-left: 18px; }
.sc-result__files li { font-size: var(--mk-fs-micro); color: var(--mk-blue, #2c63d0); line-height: 1.8; }
.sc-result__snippets { margin-top: 14px; border-top: 1px solid var(--mk-line, #e6ebf4); padding-top: 10px; }
.sc-result__snippets summary { cursor: pointer; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted, #5b6577); }
.sc-result__snippet { margin-top: 8px; }
.sc-result__snippet-title { display: block; font-size: var(--mk-fs-micro); color: var(--mk-blue, #2c63d0); margin-bottom: 4px; }
.sc-result__pre {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: var(--mk-radius-xl);
  background: #f8fafc;
  color: var(--mk-ink, #1a2a44);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 260px;
  overflow: auto;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
    .pw-hash { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
    .pw-hash { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与表格正文对齐 */
    .pw-hash { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：Skill 工作台 ================= */
html[data-theme='dark'] {
  .sc-msg { background: #19191a; border-color: #2a2b2d; }
  .sc-msg--error { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.35); }
  .sc-badge-kind { background: #2d2d2f; }

  /* 补漏：输入框/代码块浅底 */
  .sc-field__input { background: #19191a; }
  .sc-result__pre { background: #141415; color: var(--mk-pre-fg); }
}
</style>
