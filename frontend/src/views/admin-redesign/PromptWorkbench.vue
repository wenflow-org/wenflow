<template>
  <div :class="{ 'mk-page': !embedded }">
    <!-- 状态条（嵌入编排图时隐藏，编排页已有自己的状态栏） -->
    <div v-if="!embedded" class="mk-status" :class="cores.some((c) => c.status === 'pending-compile') ? 'mk-status--warn' : syncedCount ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Skill 工作台</strong>
      <span class="mk-status__sep"></span>
      <!-- 三态合计口径：此前全量 no-prompt 时只显示「同步 0 / 待编译发布 0」，
           与「核心文件 N」对不上，用户以为数据没加载 -->
      <span class="mk-status__meta" :title="coreCountTitle">核心文件 {{ cores.length }}</span>
      <span class="mk-status__meta pw-ok" :title="`已同步：编译产物与 core.yaml 一致（${syncedCount} 个）`">同步 {{ syncedCount }}</span>
      <span class="mk-status__meta pw-warn" :title="`待编译发布：core.yaml 有改动但未重新编译（${pendingCount} 个）`">待编译发布 {{ pendingCount }}</span>
      <span v-if="noPromptCount" class="mk-status__meta pw-na" :title="`无 Prompt：尚未创建 core.yaml，不参与编译（${noPromptCount} 个）`">无 Prompt {{ noPromptCount }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadList">
          <MkLoading v-if="loading" inline text="刷新中…" /><span v-else>刷新</span>
        </button>
      </span>
    </div>

    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">核心文件</h3>
        <span class="mk-card__meta">改提示词与发布在 Skill 设计页「协议」页签；从 0 新建是代码级动作，走 CLI：backend/scripts/scaffold-skill.ts（见 doc/SKILL_DEVELOPMENT_GUIDE.md）</span>
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
          <tr
            v-for="item in shownCores"
            :key="item.skillId"
            tabindex="0"
            @click="openDesign(item.skillId)"
            @keydown.enter.prevent="openDesign(item.skillId)"
          >
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
        :icon="loadError ? '⚠' : '◌'"
        :tone="loadError ? 'error' : 'neutral'"
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

const syncedCount = computed(() => countBy('synced'));
const pendingCount = computed(() => countBy('pending-compile'));
const noPromptCount = computed(() => countBy('no-prompt'));

/** 三态合计口径：已同步 + 待编译发布 + 无 Prompt = 核心文件总数（statusBar title） */
const coreCountTitle = computed(() =>
  `三态合计：已同步 ${syncedCount.value} + 待编译发布 ${pendingCount.value} + 无 Prompt ${noPromptCount.value} = 核心文件 ${cores.value.length}`
);

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
.pw-na { color: var(--mk-faint, #5b6577); }
.pw-hash { font-size: var(--mk-fs-micro); }
.mk-table--click tbody tr { cursor: pointer; }

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
</style>
