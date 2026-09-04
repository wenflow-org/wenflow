<template>
  <div class="mk-page--fill ms-host">
    <!-- 合并宿主页头：标题 + 同域双子视图 tab（公告=全站横幅 / 站内通知=按用户站内信）
         数据层独立（announcements / notifications 表），页面级 tab 收敛管理侧双入口 -->
    <div class="ms-tabsbar">
      <strong class="ms-title">通知与公告</strong>
      <div class="mk-pills ms-tabs">
        <button
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': tab === 'announce' }"
          @click="switchTab('announce')"
        >公告</button>
        <button
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': tab === 'inapp' }"
          @click="switchTab('inapp')"
        >站内通知</button>
      </div>
      <span class="mk-card__meta" :title="'公告=全站横幅（生效中/草稿/已下线）；站内通知=按用户推送（系统/公告提醒/成就）'">
        触达双通道：横幅公告 与 站内信
      </span>
    </div>

    <!-- 公告：Announcements（状态条 + 列表 + 新建/编辑弹窗） -->
    <Announcements v-if="tab === 'announce'" embedded />
    <!-- 站内通知：Notifications（状态条 + 列表 + 发送弹窗） -->
    <Notifications v-else embedded />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'

type MessagesTab = 'announce' | 'inapp'
const TABS: MessagesTab[] = ['announce', 'inapp']

const tab = ref<MessagesTab>('announce')
const route = useRoute()
const router = useRouter()

/* URL ↔ tab 双向同步：?tab=announce|inapp（深链/刷新/前进后退可寻址，合并页统一约定） */
watch(
  () => route.query.tab,
  (t) => {
    const v = typeof t === 'string' && TABS.includes(t as MessagesTab) ? (t as MessagesTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'announce') tab.value = 'announce'
  },
  { immediate: true }
)
function switchTab(t: MessagesTab) {
  tab.value = t
  if (route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* intent 深链：跨页跳转带 tab（运营中心「公告 →」→ announce / 命令面板「新建公告」强转 announce） */
watch(
  () => intent.tab,
  (t) => {
    if (t === 'announce' || t === 'inapp') {
      tab.value = t
      intent.tab = ''
    }
  },
  { immediate: true }
)
/* 命令面板「新建公告」：确保落在公告 tab（Announcements 挂载后自行消费 quickAction） */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-announcement' && tab.value !== 'announce') tab.value = 'announce'
  },
  { immediate: true }
)
</script>

<style scoped>
/* 宿主为应用式布局容器：自身铺满、内滚由子组件接管 */
.ms-host {
  padding: var(--mk-space-3) var(--mk-space-4) var(--mk-space-4);
}
.ms-tabsbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.ms-title {
  font-size: var(--mk-fs-14);
  font-weight: 800;
  color: var(--mk-ink);
  white-space: nowrap;
}
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度 */
.ms-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
