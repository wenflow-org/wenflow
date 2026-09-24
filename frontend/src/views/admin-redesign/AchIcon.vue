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
  color: #fff;
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  line-height: 1;
  vertical-align: -4px;
  background: #94a3b8;
}
.ach-icon--info { background: var(--mk-blue); }
.ach-icon--ok { background: var(--mk-green-fill, #15803d); }
.ach-icon--warn { background: var(--mk-amber-fill, #b45309); }
.ach-icon--mastery { background: #7c3aed; }
.ach-icon--muted { background: #94a3b8; }
.ach-icon--lg {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  font-size: var(--mk-fs-body);
  vertical-align: middle;
}
html[data-theme='dark'] .ach-icon--muted { background: #4d4e51; }
</style>
