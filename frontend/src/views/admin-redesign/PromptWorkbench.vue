<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Prompt 核心文件目录（v4）</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">核心文件 {{ cores.length }}</span>
      <span class="mk-status__meta pw-ok">同步 {{ countBy('synced') }}</span>
      <span class="mk-status__meta pw-warn">待编译发布 {{ countBy('pending-compile') }}</span>
      <div class="pl-actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadList">
          <span v-if="loading"><span class="mk-spinner"></span> 刷新中…</span><span v-else>刷新</span>
        </button>
      </div>
    </div>

    <p class="pw-lead">编辑与发布在 Skill 设计页的「协议」页签。</p>


    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">核心文件</h3>
        <span class="mk-card__meta">{{ cores.length }} 个</span>
      </div>
      <div class="mk-table-scroll">
      <table v-if="cores.length" class="mk-table mk-table--click">
        <thead>
          <tr>
            <th>Skill</th>
            <th>结构</th>
            <th>输出</th>
            <th>coreHash</th>
            <th>状态</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in cores" :key="item.skillId" @click="openDesign(item.skillId)">
            <td><code class="mono">{{ item.skillId }}</code></td>
            <td class="mk-na">{{ item.fields }} 字段 · {{ item.channels.length }} 通道</td>
            <td class="mk-na">{{ item.outputMedia }}<template v-if="item.deltaOutput"> · delta</template></td>
            <td><code class="mono pw-hash">{{ shortHash(item.coreHash) }}</code></td>
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
      <div v-if="!cores.length && !loading" class="mk-empty">
        <span v-if="!loadError" class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>{{ loadError ? '清单加载失败' : '未发现核心文件' }}</strong>
        <span v-if="loadError">{{ loadError }}</span>
        <button v-if="loadError" type="button" class="mk-empty__action" @click="loadList">重试</button>
        <span v-else>编辑与发布入口在 Skill 设计页的「协议」页签。</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminPromptWorkbenchApi } from '@/api/adminApi';
import { toast } from '@/utils/toast'

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
  } catch (e: any) {
    cores.value = [];
    loadError.value = `清单加载失败：${e?.message || e}`;
    toast.error(`清单加载失败：${e?.message || e}`);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadList();
});
</script>

<style scoped>
.pw-ok { color: var(--mk-green, #15803d); }
.pw-warn { color: var(--mk-amber, #b45309); }
.pw-lead {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-faint, #8492ab);
  line-height: 1.7;
}
.pw-hash { font-size: 11px; }
.pl-actions { margin-left: auto; }
.mk-table--click tbody tr { cursor: pointer; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .pw-lead { font-size: 14px; }
  .pw-hash { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .pw-lead { font-size: 15.5px; }
  .pw-hash { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与表格正文对齐 */
  .pw-lead { font-size: 18px; }
  .pw-hash { font-size: 16.5px; }
}
</style>
