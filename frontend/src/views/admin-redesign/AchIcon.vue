<template>
  <!-- 成就图标：按类型渲染统一「品牌色块 + 首字标」，替代各系统渲染不一的 emoji
       （🎓🚀🏆👑 …），与全站线性图标 + 色块徽标语言一致。 -->
  <span
    class="ach-icon"
    :class="[`ach-icon--${meta.tone}`, size === 'lg' ? 'ach-icon--lg' : '']"
    :title="meta.label"
    :aria-label="meta.label"
    role="img"
  >{{ meta.mark }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const ACH_TYPE_MARK: Record<string, { mark: string; tone: string; label: string }> = {
  milestone: { mark: '里', tone: 'info', label: '里程碑' },
  streak: { mark: '连', tone: 'warn', label: '连续' },
  completion: { mark: '完', tone: 'ok', label: '完成度' },
  mastery: { mark: '掌', tone: 'mastery', label: '掌握' },
  social: { mark: '社', tone: 'muted', label: '社交' },
}

const props = withDefaults(defineProps<{ type?: string; size?: 'sm' | 'lg' }>(), {
  type: '',
  size: 'sm',
})

const meta = computed(
  () => ACH_TYPE_MARK[props.type] || { mark: '成', tone: 'muted', label: '成就' }
)
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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  line-height: 1;
  vertical-align: -4px;
  /* 灰档底色原为 #94a3b8：白字对比仅 2.56:1（小字 AA 要求 4.5:1），且未知 type 兜底
     就落这一档——后台返回任何新成就类型都会命中。改深 slate #64748b（白字实算 4.76:1）。 */
  background: #64748b;
}
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
  font-size: var(--mk-fs-body);
  vertical-align: middle;
}
html[data-theme='dark'] .ach-icon--muted { background: #4d4e51; }
</style>
