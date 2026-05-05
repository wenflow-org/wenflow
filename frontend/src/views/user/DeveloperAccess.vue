<template>
  <CapabilityShell
    title="开发者接入"
    description="以个人中心为入口，统一查看 API 调用方式、可用能力域和第三方接入路线。"
  >
    <div class="developer-access-page">
      <section class="hero glass-card">
        <div>
          <p class="hero-eyebrow">Open Platform</p>
          <h1>第三方接入工作台</h1>
          <p>当前版本支持基于 JWT 的 API 调用接入，SDK / Webhook / 插件市场按阶段开放。</p>
        </div>
        <el-tag type="success" effect="plain">{{ overview.authMode || 'jwt-bearer' }}</el-tag>
      </section>

      <section class="status-grid">
        <el-card class="glass-card">
          <template #header>接入状态</template>
          <div class="status-list">
            <div class="status-item"><span>认证方式</span><strong>{{ overview.authMode || '-' }}</strong></div>
            <div class="status-item"><span>SDK</span><strong>{{ overview.sdkStatus || '-' }}</strong></div>
            <div class="status-item"><span>Webhook</span><strong>{{ overview.webhookStatus || '-' }}</strong></div>
            <div class="status-item"><span>插件市场</span><strong>{{ overview.pluginMarketplaceStatus || '-' }}</strong></div>
          </div>
        </el-card>

        <el-card class="glass-card">
          <template #header>建议接入顺序</template>
          <ol class="steps-list">
            <li>先联调 Goal Conversation API</li>
            <li>接 Learning Paths API 做结果闭环</li>
            <li>最后在用户侧绑定平台已发布的 Agent 与 Skill</li>
          </ol>
        </el-card>
      </section>

      <section class="endpoints glass-card">
        <div class="section-title-row">
          <h2>可用 API 组</h2>
          <el-button link type="primary" @click="$router.push('/docs')">查看完整文档</el-button>
        </div>
        <div class="endpoint-group" v-for="group in overview.endpointGroups || []" :key="group.name">
          <div class="group-header">
            <strong>{{ group.name }}</strong>
            <span class="base-path">{{ group.basePath }}</span>
          </div>
          <div class="endpoint-list">
            <el-tag v-for="endpoint in group.endpoints" :key="endpoint" effect="plain">{{ endpoint }}</el-tag>
          </div>
        </div>
      </section>

      <section class="quickstart glass-card">
        <div class="section-title-row">
          <h2>Quickstart</h2>
          <el-button size="small" @click="copyQuickstart">复制示例</el-button>
        </div>
        <pre>{{ quickstart }}</pre>
      </section>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { toast } from '../../utils/toast';
import { getDeveloperOverview, getDeveloperQuickstart } from '@/api/userCustom';

const overview = reactive<any>({
  authMode: 'jwt-bearer',
  sdkStatus: 'planned',
  webhookStatus: 'planned',
  pluginMarketplaceStatus: 'planned',
  endpointGroups: []
});

const quickstart = ref('加载中...');

onMounted(async () => {
  await Promise.all([loadOverview(), loadQuickstart()]);
});

async function loadOverview() {
  try {
    const res = await getDeveloperOverview();
    Object.assign(overview, res.data || {});
  } catch {
    toast.warning('开发者概览读取失败，展示默认信息');
  }
}

async function loadQuickstart() {
  try {
    const res = await getDeveloperQuickstart();
    quickstart.value = res.data?.quickstart || '暂无 quickstart 内容';
  } catch {
    quickstart.value = '暂无 quickstart 内容';
  }
}

async function copyQuickstart() {
  try {
    await navigator.clipboard.writeText(quickstart.value);
    toast.success('Quickstart 已复制');
  } catch {
    toast.error('复制失败，请手动复制');
  }
}
</script>

<style scoped>
.developer-access-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.glass-card {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(20px);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}

[data-theme="dark"] .glass-card {
  background: rgba(26, 37, 47, 0.72);
  border-color: rgba(255, 255, 255, 0.1);
}

.hero {
  padding: 1.25rem 1.5rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.hero h1 {
  margin: 0 0 0.4rem;
  font-size: 1.35rem;
  color: var(--text-primary);
}

.hero p {
  margin: 0;
  color: var(--text-secondary);
}

.hero-eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.status-list {
  display: grid;
  gap: 0.55rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  background: var(--bg-muted);
}

.steps-list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.endpoints,
.quickstart {
  padding: 1rem 1.25rem;
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
}

.section-title-row h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.endpoint-group {
  border-top: 1px solid var(--border-light);
  padding-top: 0.8rem;
  margin-top: 0.8rem;
}

.group-header {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.6rem;
}

.base-path {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}

.endpoint-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

pre {
  margin: 0;
  padding: 0.9rem;
  border-radius: 12px;
  background: var(--bg-muted);
  color: var(--text-primary);
  border: 1px solid var(--border-light);
  overflow-x: auto;
  font-size: 0.8rem;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .status-grid {
    grid-template-columns: 1fr;
  }

  .hero {
    flex-direction: column;
  }
}
</style>
