<template>
  <Teleport to="body">
    <button
      v-if="isTestMode"
      class="dev-overlay-float-btn"
      @click="drawerVisible = true"
      title="开发调试浮层"
    >
      <el-icon :size="20"><Monitor /></el-icon>
    </button>

    <el-drawer
      v-if="isTestMode"
      v-model="drawerVisible"
      title="开发调试浮层"
      direction="rtl"
      size="min(92vw, 880px)"
      class="dev-overlay-drawer"
    >
      <div class="dev-overlay-content">
        <!-- 身份面板 -->
        <section class="dev-section">
          <div class="dev-section-head">
            <span class="dev-section-title">当前身份</span>
            <el-button v-if="projection.active" size="small" type="warning" @click="exitProjection">退出投影</el-button>
          </div>
          <div class="dev-card">
            <div class="dev-identity-row">
              <span class="dev-identity-badge" :class="projection.active ? 'is-projection' : 'is-admin'">
                {{ projection.active ? '投影中' : 'Admin 自身' }}
              </span>
              <span class="dev-identity-name">{{ projection.label }}</span>
            </div>
            <div v-if="projection.active" class="dev-identity-meta">
              <span v-if="projection.scope">scope: {{ projection.scope }}</span>
              <span v-if="projection.storyId">storyId: {{ projection.storyId }}</span>
            </div>
            <div class="dev-identity-actions">
              <el-button size="small" @click="openVlPicker">切换为虚拟用户...</el-button>
            </div>
          </div>
        </section>

        <!-- 通用层 -->
        <section class="dev-section">
          <div class="dev-section-head">
            <span class="dev-section-title">通用追踪</span>
            <el-button size="small" :loading="traceLoading" @click="trace.refresh()">刷新</el-button>
          </div>

          <!-- traceId -->
          <div class="dev-card" v-if="debugStore.currentTraceId">
            <div class="dev-card-label">当前 Trace ID</div>
            <div class="dev-trace-row">
              <code class="dev-trace-id">{{ debugStore.currentTraceId }}</code>
              <el-button size="small" link type="primary" @click="goToExecutionLogs">
                查看完整链路 →
              </el-button>
            </div>
            <div class="dev-trace-meta" v-if="traceLogs.length > 0">
              本次请求 {{ traceLogs.length }} 条日志
            </div>
          </div>

          <!-- skill 调用链 -->
          <div class="dev-card" v-if="skillChain.length > 0">
            <div class="dev-card-label">当前路由 Skill 调用链</div>
            <div class="dev-skill-chain">
              <div v-for="item in skillChain" :key="item.skillId" class="dev-skill-item">
                <span class="dev-skill-name">{{ item.skillId }}</span>
                <span v-if="item.parentAgent" class="dev-skill-agent">← {{ item.parentAgent }}</span>
                <div class="dev-skill-stats" v-if="item.callCount !== undefined">
                  <span>调用 {{ item.callCount }}</span>
                  <span :class="{ 'dev-drift': item.successRate < 0.8 }">
                    成功率 {{ (item.successRate * 100).toFixed(0) }}%
                  </span>
                  <span v-if="item.promptDrift" class="dev-drift-warn">⚠ Prompt 漂移</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 最近 Prompt 调用 -->
          <div class="dev-card" v-if="recentPromptCalls.length > 0">
            <div class="dev-card-label">最近 Prompt 调用</div>
            <div class="dev-prompt-list">
              <div
                v-for="call in recentPromptCalls.slice(0, 5)"
                :key="call.id || call.createdAt"
                class="dev-prompt-item"
                :class="{ 'dev-prompt-drift': call.promptDrift }"
              >
                <span class="dev-prompt-agent">{{ call.agentId }}</span>
                <span :class="call.success ? 'dev-ok' : 'dev-fail'">
                  {{ call.success ? '✓' : '✗' }}
                </span>
                <span class="dev-prompt-duration">{{ call.durationMs }}ms</span>
                <span class="dev-prompt-time">{{ formatTime(call.createdAt) }}</span>
                <span v-if="call.promptDrift" class="dev-drift-warn">漂移</span>
              </div>
            </div>
          </div>

          <!-- manifest 诊断 -->
          <div class="dev-card" v-if="manifestDiagnostics">
            <div class="dev-card-label">Manifest 诊断</div>
            <div class="dev-manifest">
              <span v-if="manifestDiagnostics.driftCount > 0" class="dev-drift-warn">
                {{ manifestDiagnostics.driftCount }} 项漂移
              </span>
              <span v-else class="dev-ok">✓ 无漂移</span>
            </div>
          </div>
        </section>

        <!-- A 类层：路由特定数据 -->
        <section class="dev-section" v-if="hasRouteSpecificData">
          <div class="dev-section-title">当前页面数据（独立拉取）</div>
          <div class="dev-card">
            <pre class="dev-json">{{ JSON.stringify(routeSpecificData, null, 2) }}</pre>
          </div>
        </section>

        <!-- 事件总线 -->
        <section class="dev-section" v-if="eventHistory.length > 0">
          <div class="dev-section-title">事件总线（最近 {{ eventHistory.length }} 条）</div>
          <div class="dev-card">
            <div class="dev-event-list">
              <div v-for="(evt, idx) in eventHistory.slice(0, 10)" :key="idx" class="dev-event-item">
                <span class="dev-event-type">{{ evt.type }}</span>
                <span class="dev-event-time">{{ formatTime(evt.timestamp) }}</span>
                <span v-if="evt.userId" class="dev-event-user">{{ evt.userId.slice(0, 8) }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- B 类镜像层 -->
        <section class="dev-section" v-if="debugStore.goalDebugData || debugStore.teachingDebugTraces.length > 0">
          <div class="dev-section-title">实时镜像（拦截器捕获）</div>

          <!-- Goal 对话 debug -->
          <div class="dev-card" v-if="debugStore.goalDebugData">
            <div class="dev-card-label">Goal 对话 Debug</div>
            <div class="dev-mirror-meta">
              <span>attempts: {{ debugStore.goalDebugData.attemptCount ?? '--' }}</span>
              <span>parseMode: {{ debugStore.goalDebugData.parseMode ?? '--' }}</span>
              <span>requestLog: {{ debugStore.goalDebugData.requestLog.length }} 条</span>
            </div>
            <pre class="dev-json">{{ JSON.stringify(debugStore.goalDebugData, null, 2) }}</pre>
          </div>

          <!-- Teaching debug traces -->
          <div class="dev-card" v-if="debugStore.teachingDebugTraces.length > 0">
            <div class="dev-card-label">授课 Debug（最近 {{ debugStore.teachingDebugTraces.length }} 轮）</div>
            <div
              v-for="(teachingTrace, idx) in debugStore.teachingDebugTraces.slice(-5).reverse()"
              :key="idx"
              class="dev-teaching-trace"
            >
              <div class="dev-teaching-head">
                <span>第 {{ debugStore.teachingDebugTraces.length - idx }} 轮</span>
                <span v-if="teachingTrace.traceId" class="dev-trace-mini">{{ teachingTrace.traceId.slice(0, 20) }}...</span>
              </div>
              <pre class="dev-json">{{ JSON.stringify(teachingTrace.promptDebug, null, 2) }}</pre>
            </div>
          </div>
        </section>

        <!-- 路由信息 -->
        <section class="dev-section">
          <div class="dev-section-title">路由信息</div>
          <div class="dev-card">
            <div class="dev-route-info">
              <span>name: <code>{{ route.name }}</code></span>
              <span>path: <code>{{ route.path }}</code></span>
              <span>isTestMode: <code>{{ isTestMode }}</code></span>
            </div>
          </div>
        </section>
      </div>
    </el-drawer>

    <el-dialog
      v-if="isTestMode"
      v-model="vlPickerVisible"
      title="选择虚拟用户进行投影"
      width="640px"
      append-to-body
    >
      <div class="dev-vl-picker">
        <el-input
          v-model="vlPickerKeyword"
          placeholder="按姓名/邮箱过滤"
          clearable
          size="small"
          class="dev-vl-picker__search"
        />
        <div v-if="vlPickerLoading" class="dev-vl-picker__empty">加载中...</div>
        <div v-else-if="vlListFiltered.length === 0" class="dev-vl-picker__empty">
          暂无虚拟用户，请先在 /admin/virtual-learners 创建
        </div>
        <div v-else class="dev-vl-picker__list">
          <div
            v-for="vl in vlListFiltered"
            :key="vl.id"
            class="dev-vl-picker__item"
            @click="confirmProjection(vl)"
          >
            <div class="dev-vl-picker__name">{{ vl.userName || vl.email || vl.id }}</div>
            <div class="dev-vl-picker__email">{{ vl.email }}</div>
            <div class="dev-vl-picker__id">profile: {{ vl.id }}</div>
          </div>
        </div>
      </div>
    </el-dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Monitor } from '@element-plus/icons-vue';
import { isTestMode } from '@/utils/debugMode';
import { useDebugStore } from '@/stores/debug';
import { useDebugTrace } from '@/composables/useDebugTrace';
import {
  getProjectionContext,
  isProjectionMode,
  setProjectionToken,
  clearProjectionToken,
} from '@/utils/projection';
import { adminApi } from '@/api/adminApi';

const route = useRoute();
const router = useRouter();
const debugStore = useDebugStore();
const drawerVisible = ref(false);

const trace = useDebugTrace();
const {
  skillChain,
  recentPromptCalls,
  traceLogs,
  manifestDiagnostics,
  eventHistory,
  routeSpecificData,
  loading: traceLoading,
} = trace;

const hasRouteSpecificData = computed(() =>
  routeSpecificData.value && Object.keys(routeSpecificData.value).length > 0
);

watch(drawerVisible, (visible) => {
  if (visible) {
    trace.refresh();
    trace.startPolling(5000);
  } else {
    trace.stopPolling();
  }
});

function goToExecutionLogs() {
  if (!debugStore.currentTraceId) return;
  router.push({ path: '/admin/execution-logs', query: { traceId: debugStore.currentTraceId } });
}

function formatTime(time: string | number): string {
  if (!time) return '--';
  try {
    const d = new Date(time);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  } catch {
    return '--';
  }
}

// ============ 身份面板 ============
interface ProjectionInfo {
  active: boolean;
  label: string;
  profileId?: string;
  scope?: string;
  storyId?: string | null;
}

const projection = ref<ProjectionInfo>({ active: false, label: 'Admin 自身' });

function refreshProjectionState() {
  if (!isProjectionMode()) {
    projection.value = { active: false, label: 'Admin 自身' };
    return;
  }
  const ctx = getProjectionContext() || {};
  projection.value = {
    active: true,
    label: ctx.userName || ctx.email || ctx.profileId || '未知投影用户',
    profileId: ctx.profileId,
    scope: ctx.scope,
    storyId: ctx.storyId,
  };
}

refreshProjectionState();
window.addEventListener('storage', refreshProjectionState);
watch(() => route.fullPath, refreshProjectionState);

// 虚拟用户选择器
const vlPickerVisible = ref(false);
const vlPickerLoading = ref(false);
const vlPickerKeyword = ref('');
const vlList = ref<any[]>([]);

const vlListFiltered = computed(() => {
  const kw = vlPickerKeyword.value.trim().toLowerCase();
  if (!kw) return vlList.value;
  return vlList.value.filter((v) =>
    `${v.userName || ''} ${v.email || ''} ${v.id || ''}`.toLowerCase().includes(kw)
  );
});

async function openVlPicker() {
  vlPickerVisible.value = true;
  if (vlList.value.length > 0) return;
  vlPickerLoading.value = true;
  try {
    const resp: any = await adminApi.getVirtualLearners({ limit: 100 });
    const body = resp?.data?.data || resp?.data || resp;
    const list = body?.items || body?.profiles || body?.list || (Array.isArray(body) ? body : []);
    vlList.value = list.map((item: any) => ({
      id: item.id,
      userName: item.users?.name || item.userName || item.profile?.name,
      email: item.users?.email || item.email,
      userId: item.userId || item.users?.id,
    }));
  } catch (err: any) {
    ElMessage.error(err?.message || '加载虚拟用户列表失败');
  } finally {
    vlPickerLoading.value = false;
  }
}

async function confirmProjection(vl: any) {
  try {
    const resp: any = await adminApi.createProjectionToken(vl.id, { scope: 'full' });
    const body = resp?.data || resp;
    if (!body?.success) {
      throw new Error(body?.error || '创建投影 token 失败');
    }
    const token = body.data?.token;
    if (!token) throw new Error('投影 token 缺失');
    setProjectionToken(token, {
      profileId: vl.id,
      userName: vl.userName,
      email: vl.email,
      scope: 'full',
    });
    vlPickerVisible.value = false;
    refreshProjectionState();
    ElMessage.success(`已切换为 ${vl.userName || vl.email}，即将刷新页面`);
    setTimeout(() => window.location.reload(), 600);
  } catch (err: any) {
    ElMessage.error(err?.message || '投影失败');
  }
}

async function exitProjection() {
  try {
    await ElMessageBox.confirm('退出投影后将以 admin 自身身份继续，确认？', '退出投影', {
      type: 'warning',
    });
    clearProjectionToken();
    refreshProjectionState();
    ElMessage.success('已退出投影，即将刷新');
    setTimeout(() => window.location.reload(), 400);
  } catch {
    // 取消
  }
}
</script>

<style scoped>
.dev-overlay-float-btn {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 10000;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
}
.dev-overlay-float-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(99, 102, 241, 0.5);
}
.dev-overlay-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 4px;
}
.dev-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dev-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dev-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dev-card {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dev-card-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}
.dev-trace-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dev-trace-id {
  font-size: 12px;
  background: var(--el-fill-color-darker);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--el-color-primary);
  font-family: monospace;
}
.dev-trace-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dev-skill-chain {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dev-skill-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.dev-skill-name {
  font-weight: 500;
  color: var(--el-color-primary);
}
.dev-skill-agent {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.dev-skill-stats {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.dev-prompt-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dev-prompt-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
}
.dev-prompt-item.dev-prompt-drift {
  color: var(--el-color-warning);
}
.dev-prompt-agent {
  font-family: monospace;
  min-width: 180px;
}
.dev-prompt-duration {
  color: var(--el-text-color-secondary);
}
.dev-prompt-time {
  color: var(--el-text-color-secondary);
  margin-left: auto;
}
.dev-ok {
  color: var(--el-color-success);
}
.dev-fail {
  color: var(--el-color-danger);
}
.dev-drift-warn {
  color: var(--el-color-warning);
  font-size: 11px;
}
.dev-drift {
  color: var(--el-color-danger) !important;
}
.dev-manifest {
  font-size: 13px;
}
.dev-mirror-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dev-json {
  background: var(--el-fill-color-darker);
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-family: monospace;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.dev-teaching-trace {
  border-left: 2px solid var(--el-color-primary);
  padding-left: 8px;
  margin-bottom: 8px;
}
.dev-teaching-head {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.dev-trace-mini {
  font-family: monospace;
  color: var(--el-color-primary);
}
.dev-route-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.dev-route-info code {
  background: var(--el-fill-color-darker);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: monospace;
}
.dev-event-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
}
.dev-event-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
}
.dev-event-type {
  font-family: monospace;
  color: var(--el-color-primary);
  min-width: 200px;
}
.dev-event-time {
  color: var(--el-text-color-secondary);
}
.dev-event-user {
  font-family: monospace;
  color: var(--el-text-color-secondary);
  margin-left: auto;
}

/* 身份面板 */
.dev-identity-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.dev-identity-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.dev-identity-badge.is-admin {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
}
.dev-identity-badge.is-projection {
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
}
.dev-identity-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dev-identity-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}
.dev-identity-actions {
  display: flex;
  gap: 8px;
}

/* 虚拟用户选择器 */
.dev-vl-picker__search {
  margin-bottom: 12px;
}
.dev-vl-picker__empty {
  padding: 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.dev-vl-picker__list {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dev-vl-picker__item {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.dev-vl-picker__item:hover {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.05);
}
.dev-vl-picker__name {
  font-weight: 600;
  font-size: 14px;
}
.dev-vl-picker__email {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dev-vl-picker__id {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  font-family: monospace;
  margin-top: 2px;
}
</style>
