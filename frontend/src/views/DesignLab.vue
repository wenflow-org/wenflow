<template>
  <section class="design-lab" :style="themeVars">
    <div class="design-lab__backdrop" aria-hidden="true">
      <span class="orb orb--one"></span>
      <span class="orb orb--two"></span>
      <span class="orb orb--three"></span>
    </div>

    <div class="lab-shell">
      <header class="demo-bar">
        <div class="demo-bar__top">
          <div class="demo-brand">
            <span class="demo-brand__pill">WenFlow UI Lab</span>
            <strong>问流陪伴式学习体验</strong>
          </div>

          <div class="demo-actions">
            <span class="theme-pill">{{ activeTheme.name }}</span>
            <button
              type="button"
              class="ghost-button ghost-button--small mobile-toggle"
              :class="{ 'mobile-toggle--active': activeDevice === 'mobile' }"
              :aria-pressed="activeDevice === 'mobile'"
              @click="toggleMobilePreview"
            >
              {{ activeDevice === 'mobile' ? '退出移动版预览' : '移动版预览' }}
            </button>
            <router-link to="/" class="ghost-button ghost-button--small demo-link">返回首页</router-link>
          </div>
        </div>

        <nav class="scene-nav" aria-label="UI Lab 页面导航">
          <button
            v-for="scene in scenes"
            :key="scene.id"
            type="button"
            class="scene-nav__item"
            :class="{ 'scene-nav__item--active': scene.id === activeSceneId }"
            :aria-pressed="scene.id === activeSceneId"
            @click="activeSceneId = scene.id"
          >
            {{ scene.title }}
          </button>
        </nav>
      </header>

      <main class="demo-stage">
        <DesignLabPreview
          :theme="activeTheme"
          :scene="activeScene"
          :device="activeDevice"
          :device-label="activeDeviceLabel"
        />
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import DesignLabPreview from './DesignLabPreview.vue';
import { scenes, themes, type DeviceId, type SceneId } from './design-lab.data';

const activeTheme = themes[0];
const activeSceneId = ref<SceneId>('home');
const activeDevice = ref<DeviceId>('desktop');

const activeScene = computed(() => scenes.find((scene) => scene.id === activeSceneId.value) ?? scenes[0]);
const activeDeviceLabel = computed(() => (activeDevice.value === 'mobile' ? '移动版预览' : '桌面版预览'));

const themeVars = computed(() => ({
  '--lab-canvas': activeTheme.tokens.canvas,
  '--lab-surface': activeTheme.tokens.surface,
  '--lab-surface-alt': activeTheme.tokens.surfaceAlt,
  '--lab-border': activeTheme.tokens.border,
  '--lab-border-strong': activeTheme.tokens.borderStrong,
  '--lab-text': activeTheme.tokens.text,
  '--lab-muted': activeTheme.tokens.muted,
  '--lab-primary': activeTheme.tokens.primary,
  '--lab-secondary': activeTheme.tokens.secondary,
  '--lab-accent': activeTheme.tokens.accent,
  '--lab-success': activeTheme.tokens.success,
  '--lab-warning': activeTheme.tokens.warning,
  '--lab-danger': activeTheme.tokens.danger,
  '--lab-nav-bg': activeTheme.tokens.navBg,
  '--lab-chip': activeTheme.tokens.chip,
  '--lab-shadow': activeTheme.tokens.shadow,
  '--lab-hero-gradient': activeTheme.tokens.heroGradient,
  '--lab-user-bubble': activeTheme.tokens.userBubble,
  '--lab-ai-bubble': activeTheme.tokens.aiBubble,
  '--lab-track': activeTheme.tokens.track,
  '--lab-card-radius': activeTheme.tokens.cardRadius,
  '--lab-pill-radius': activeTheme.tokens.pillRadius,
  '--lab-display-font': activeTheme.tokens.displayFont,
  '--lab-body-font': activeTheme.tokens.bodyFont
}));

const toggleMobilePreview = () => {
  activeDevice.value = activeDevice.value === 'mobile' ? 'desktop' : 'mobile';
};
</script>

<style scoped>
.design-lab {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.88), transparent 28%),
    linear-gradient(180deg, var(--lab-canvas) 0%, color-mix(in srgb, var(--lab-canvas) 86%, white) 100%);
  color: var(--lab-text);
  font-family: var(--lab-body-font);
}

.design-lab__backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(52px);
  opacity: 0.42;
}

.orb--one {
  width: 380px;
  height: 380px;
  top: -120px;
  left: -80px;
  background: color-mix(in srgb, var(--lab-primary) 30%, white);
}

.orb--two {
  width: 320px;
  height: 320px;
  top: 12%;
  right: -80px;
  background: color-mix(in srgb, var(--lab-accent) 22%, white);
}

.orb--three {
  width: 260px;
  height: 260px;
  bottom: -70px;
  left: 24%;
  background: color-mix(in srgb, var(--lab-secondary) 22%, white);
}

.lab-shell {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 14px;
  padding: 18px;
}

.demo-bar {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--lab-border);
  border-radius: 28px;
  background: color-mix(in srgb, var(--lab-surface) 90%, white);
  box-shadow: var(--lab-shadow);
  backdrop-filter: blur(20px);
}

.demo-bar__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.demo-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.demo-brand strong {
  font-family: var(--lab-display-font);
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}

.demo-brand__pill,
.theme-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--lab-chip);
  color: var(--lab-primary);
  font-size: 12px;
  font-weight: 700;
}

.theme-pill {
  background: color-mix(in srgb, var(--lab-accent) 10%, white);
  color: var(--lab-accent);
}

.demo-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.scene-nav {
  display: flex;
  gap: 10px;
  overflow: auto;
  padding-bottom: 2px;
}

.scene-nav__item {
  flex: 0 0 auto;
  padding: 10px 14px;
  border: 1px solid var(--lab-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--lab-surface-alt) 80%, white);
  color: var(--lab-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: 180ms ease;
}

.scene-nav__item--active {
  border-color: color-mix(in srgb, var(--lab-primary) 42%, var(--lab-border));
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
  color: var(--lab-primary);
}

.demo-stage {
  min-width: 0;
}

.ghost-button,
.solid-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: 180ms ease;
}

.ghost-button {
  border-color: var(--lab-border);
  background: color-mix(in srgb, var(--lab-surface-alt) 82%, white);
  color: var(--lab-text);
}

.solid-button {
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-primary) 68%, var(--lab-secondary)));
  color: #fff;
}

.ghost-button--small,
.solid-button--small {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 14px;
  font-size: 14px;
}

.mobile-toggle--active {
  border-color: color-mix(in srgb, var(--lab-primary) 42%, var(--lab-border));
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
  color: var(--lab-primary);
}

.demo-link {
  text-decoration: none;
}

@media (max-width: 980px) {
  .demo-bar__top {
    flex-direction: column;
    align-items: stretch;
  }

  .demo-actions {
    justify-content: stretch;
  }
}

@media (max-width: 720px) {
  .lab-shell {
    padding: 12px;
  }

  .demo-bar {
    border-radius: 22px;
    padding: 12px;
  }

  .demo-brand {
    flex-direction: column;
    align-items: flex-start;
  }

  .demo-brand strong {
    white-space: normal;
  }

  .demo-actions > * {
    flex: 1 1 auto;
  }
}
</style>
