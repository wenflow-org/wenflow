<template>
  <header class="nav">
    <div class="nav__brand" @click="labGo('dashboard')">
      <img src="/logo.png" alt="问流 WenFlow" class="nav__logo" />
    </div>
    <nav class="nav__links">
      <a
        v-for="item in items"
        :key="item.scene"
        :class="{ active: active === item.scene }"
        @click="labGo(item.scene)"
      >{{ item.label }}</a>
    </nav>
    <div class="nav__right">
      <a v-if="showCta" class="nav__cta" @click="labGo('goal')">＋ 规划新目标</a>
      <span v-if="live" class="live-badge" title="对话由后端真实 skill 驱动">真实 AI</span>
      <span class="nav__avatar"><i>1</i>123</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { labGo, type LabScene } from './labStore';

withDefaults(defineProps<{ active: LabScene; live?: boolean; showCta?: boolean }>(), {
  live: false,
  showCta: true
});

const items: Array<{ scene: LabScene; label: string }> = [
  { scene: 'dashboard', label: '学习台' },
  { scene: 'goal', label: '目标规划' },
  { scene: 'paths', label: '学习路径' },
  { scene: 'state', label: '学习状态' },
  { scene: 'achievements', label: '成就' }
];
</script>

<style scoped>
.nav {
  display: flex; align-items: center; gap: 28px;
  padding: 0 28px; height: 60px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line);
}
.nav__brand { display: flex; align-items: center; gap: 9px; cursor: pointer; }
.nav__logo {
  height: 38px;
  width: auto;
  object-fit: contain;
  display: block;
}
.nav__links { display: flex; gap: 4px; flex: 1; }
.nav__links a {
  padding: 7px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; text-decoration: none; transition: .14s ease;
}
.nav__links a:hover { color: var(--ink); background: #f1f5fb; }
.nav__links a.active { color: var(--blue-deep); background: rgba(52, 120, 246, 0.09); }
.nav__right { display: flex; align-items: center; gap: 12px; }
.nav__cta {
  padding: 8px 16px; border-radius: 999px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 13px; font-weight: 700;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.28);
  cursor: pointer; text-decoration: none;
}
.live-badge {
  font-size: 11px; font-weight: 800;
  color: var(--green);
  background: rgba(49, 177, 111, 0.1);
  border: 1px solid rgba(49, 177, 111, 0.3);
  padding: 3px 9px; border-radius: 999px;
}
.nav__avatar { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
.nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}
@media (max-width: 900px) {
  .nav__links { display: none; }
}
</style>
