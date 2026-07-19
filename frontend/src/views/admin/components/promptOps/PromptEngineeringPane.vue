<!--
  PromptEngineeringPane
  ============================================================
  把"工程视角"内容塞这里。运营平时不看；偶尔工程师来问"这 agent 跟谁通信"
  时折叠展开即可。
  - 基础信息（kind / id / 文件 / DB id / 调用次数 / 模型）
  - .ts 兜底常量信息
  - skill 类节点提供"打开 SkillNodeWorkbench"入口
-->
<template>
  <div class="eng-pane">
    <!-- 基础信息 -->
    <section class="eng-section">
      <h4>基础信息</h4>
      <table class="kv-table">
        <tbody>
          <tr>
            <th>kind</th>
            <td><code>{{ agent.kind }}</code></td>
          </tr>
          <tr>
            <th>agentId</th>
            <td><code>{{ agent.agentId }}</code></td>
          </tr>
          <tr v-if="agent.file">
            <th>file path</th>
            <td><code>{{ agent.file.path }}</code></td>
          </tr>
          <tr v-if="agent.file">
            <th>file hash</th>
            <td><code>{{ agent.file.hash }}</code></td>
          </tr>
          <tr v-if="agent.db && agent.db.id">
            <th>DB ACTIVE id</th>
            <td><code>{{ agent.db.id }}</code></td>
          </tr>
          <tr v-if="agent.db && agent.db.version">
            <th>DB ACTIVE version</th>
            <td><code>v{{ agent.db.version }}</code></td>
          </tr>
          <tr v-if="agent.db && agent.db.hash">
            <th>DB hash</th>
            <td><code>{{ agent.db.hash }}</code></td>
          </tr>
          <tr v-if="agent.db && agent.db.useCount !== undefined">
            <th>调用次数</th>
            <td>{{ agent.db.useCount }}</td>
          </tr>
          <tr v-if="agent.db && agent.db.model">
            <th>默认模型</th>
            <td><code>{{ agent.db.model }}</code></td>
          </tr>
          <tr v-if="agent.db && agent.db.publishedAt">
            <th>发布时间</th>
            <td>{{ formatTime(agent.db.publishedAt) }}</td>
          </tr>
          <tr v-if="agent.drift">
            <th>漂移状态</th>
            <td>
              <code :class="agent.drift === 'in-sync' ? 'drift-ok' : 'drift-bad'">
                {{ agent.drift }}
              </code>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- .ts 兜底 -->
    <section v-if="agent.tsFallback" class="eng-section">
      <h4>.ts 兜底常量</h4>
      <p class="eng-section__desc">
        以下 TypeScript 常量目前作为 <code>callPrompt</code> 的 <code>defaultSystemPrompt</code> 兜底。
      </p>
      <table class="kv-table">
        <tbody>
          <tr>
            <th>file</th>
            <td><code>{{ agent.tsFallback.file }}</code></td>
          </tr>
          <tr>
            <th>const name</th>
            <td><code>{{ agent.tsFallback.constName }}</code></td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Skill 工作台入口 -->
    <section v-if="agent.kind === 'skill'" class="eng-section">
      <h4>Skill 相关管理</h4>
      <p class="eng-section__desc">
        模型运行时参数已并入「模型运行时」一级 tab。如需引用关系或横向对比，请前往 Skill 模型配置中心。
      </p>
      <div style="display: flex; gap: 8px;">
        <el-button
          size="small"
          type="primary"
          @click="goToSkillModelConfigList"
        >
          打开 Skill 模型配置列表 →
        </el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

interface Props {
  agent: {
    kind?: string;
    agentId?: string;
    file?: { path?: string; hash?: string; [key: string]: unknown } | null;
    db?: {
      id?: string;
      version?: number | string;
      hash?: string;
      useCount?: number;
      model?: string;
      publishedAt?: string;
      [key: string]: unknown;
    } | null;
    drift?: string | null;
    tsFallback?: { file?: string; constName?: string; [key: string]: unknown } | null;
    [key: string]: unknown;
  };
}

const props = defineProps<Props>();
defineEmits<{ (e: 'open-skill-workbench', skillId: string): void }>();

const skillIdShort = computed(() =>
  String(props.agent?.agentId || '').replace(/^skill:/, '')
);

function goToSkillModelConfigList() {
  router.push({ path: '/admin/skill-model-configs', query: { skillId: skillIdShort.value } });
}

function formatTime(value: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<style scoped>
.eng-pane {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.eng-section {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--admin-bg-surface);
}

.eng-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 800;
  color: #1a2a44;
}

.eng-section__desc {
  margin: 0 0 10px;
  color: #62758f;
  font-size: 12px;
  line-height: 1.7;
}

.eng-section__desc code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.92em;
  background: #f1f5f9;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
}

.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.kv-table th {
  text-align: left;
  font-weight: 700;
  font-size: var(--admin-text-micro);
  color: #475569;
  padding: 5px 8px;
  width: 160px;
  background: #f8fafc;
  border-right: 1px solid #f1f5f9;
}

.kv-table td {
  padding: 5px 8px;
  color: #334155;
  border-bottom: 1px solid #f1f5f9;
}

.kv-table th {
  border-bottom: 1px solid #f1f5f9;
}

.kv-table code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: var(--admin-text-caption);
  background: #f1f5f9;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
}

.drift-ok {
  background: rgba(22, 163, 74, 0.08) !important;
  color: #15803d !important;
}

.drift-bad {
  background: rgba(245, 158, 11, 0.08) !important;
  color: #b45309 !important;
}
</style>
