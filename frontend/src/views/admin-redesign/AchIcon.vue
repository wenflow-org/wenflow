<template>
  <!-- 成就图标：品牌色块 + 线性图标（lucide）。
       2026-09-14 的 fd0b9fa3 为去掉后端 emoji（🏆👑🚀🎓…）改成了「色块 + 首字标」，
       但字标在界面上就是一个汉字，读不出「这是图标」（2026-10-08 反馈：logo 图没了，
       怎么成字体了）。色块语言、尺寸档、aria-label 全部保留，只把字换成真图标。 -->
  <span
    class="ach-icon"
    :class="[`ach-icon--${meta.tone}`, size === 'lg' ? 'ach-icon--lg' : '']"
    :title="meta.label"
    :aria-label="meta.label"
    role="img"
  ><component :is="meta.icon" aria-hidden="true" /></span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { achIconMeta } from './achievementIcons'

const props = withDefaults(defineProps<{ type?: string; size?: 'sm' | 'lg' }>(), {
  type: '',
  size: 'sm',
})

const meta = computed(() => achIconMeta(props.type))
</script>

<style scoped>
.ach-icon {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  flex: none;
  color: var(--mk-on-fill);
  line-height: 1;
  vertical-align: -4px;
  /* 灰档底色原为 #94a3b8：白色图标在它上面仅 2.56:1，且未知 type 兜底就落这一档
     ——后台返回任何新成就类型都会命中。改深 slate #64748b（实测 4.76:1，
     非文本图形 AA 只要 3:1）。 */
  background: #64748b;
}
/* 图标尺寸：20px 块里放 12px 线稿（lucide 默认 24 会顶满块） */
.ach-icon svg { width: 12px; height: 12px; }
/* 各档一律走 *-fill 实心族（明暗两态都保持深底，配 --mk-on-fill 白字 ≥4.5:1）。
   2026-10-08 走查实测：info 原用 --mk-blue、mastery 原用 --mk-badge-hidden-fg——
   前者在暗色档被提亮（供文字用），后者根本是 foreground 令牌，
   白字实测只剩 3.23:1 与 1.85:1。--muted 的深 slate 是前一轮同族修复留下的，保持。 */
.ach-icon--info { background: var(--mk-blue-fill, #2f6ae0); }
.ach-icon--ok { background: var(--mk-green-fill, #15803d); }
.ach-icon--warn { background: var(--mk-amber-fill, #b45309); }
.ach-icon--mastery { background: var(--mk-violet-fill, #7c3aed); }
.ach-icon--muted { background: #64748b; }
.ach-icon--lg {
  width: 26px;
  height: 26px;
  border-radius: var(--mk-radius-sm);
  vertical-align: middle;
}
.ach-icon--lg svg { width: 15px; height: 15px; }
html[data-theme='dark'] .ach-icon--muted { background: #4d4e51; }
</style>
