<template>
  <div class="mk-page">
    <div class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">前台测试台</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">isTestMode · 全量上下文</span>
      <span class="mk-status__meta">新标签打开</span>
    </div>

    <p class="dl-lead">
      以下入口进入旧版「测试模式」前台页面（路由仍挂在 <code>/admin/test/*</code>），用于全量上下文回归。
      不替代虚拟学习者黑盒实验；两者互补。
    </p>

    <div class="dl-grid">
      <a
        v-for="item in entries"
        :key="item.href"
        class="dl-card"
        :href="item.href"
        target="_blank"
        rel="noreferrer"
      >
        <span class="dl-card__group">{{ item.group }}</span>
        <strong>{{ item.label }}</strong>
        <span class="dl-card__desc">{{ item.desc }}</span>
        <span class="dl-card__href mono">{{ item.href }}</span>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ state?: string }>()

const entries = [
  {
    group: '总览',
    label: '测试学习台',
    desc: '用户 Dashboard 测试模式，全量上下文入口',
    href: '/admin/test/dashboard'
  },
  {
    group: 'Goal',
    label: '目标规划 · 全量上下文',
    desc: 'Goal 对话 full context，对齐生产链路调试',
    href: '/admin/test/goal-full'
  },
  {
    group: 'Path',
    label: '学习路径列表',
    desc: '测试模式路径列表与筛选',
    href: '/admin/test/learning-paths'
  },
  {
    group: 'State',
    label: '学习状态',
    desc: '学习状态页测试入口',
    href: '/admin/test/learning-state'
  },
  {
    group: '成就',
    label: '成就页',
    desc: '成就列表测试入口',
    href: '/admin/test/achievements'
  }
]
</script>

<style scoped>
.dl-lead {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.7;
}
.dl-lead code {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f3f5f9;
}
.dl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.dl-card {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dl-card:hover {
  border-color: rgba(52, 120, 246, 0.45);
  box-shadow: 0 4px 14px rgba(23, 32, 51, 0.06);
}
.dl-card__group {
  font-size: 11px;
  font-weight: 700;
  color: var(--mk-faint);
  letter-spacing: 0.04em;
}
.dl-card strong {
  font-size: 14px;
}
.dl-card__desc {
  font-size: 12px;
  color: var(--mk-muted);
  line-height: 1.55;
}
.dl-card__href {
  font-size: 10.5px;
  color: var(--mk-blue);
  margin-top: 4px;
}
</style>
