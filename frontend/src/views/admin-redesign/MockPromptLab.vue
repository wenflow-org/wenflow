<template>
  <div class="mk-page">
    <div class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Dry Run 完成</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">goal-conversation</span>
      <span class="mk-status__meta">+12 行新增 · −4 行删除</span>
      <button type="button" class="mk-status__action mk-status__action--primary">执行 Dry Run</button>
    </div>

    <div class="pl-grid">
      <!-- Source -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">正式 Source</h3>
          <span class="mk-card__meta">只读 · Git 管理</span>
        </div>
        <pre class="pl-pre">{{ sourceText }}</pre>
      </section>

      <!-- 候选产物：diff -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">候选产物 · 差异</h3>
          <div class="mk-pills">
            <button type="button" class="mk-pill">产物</button>
            <button type="button" class="mk-pill mk-pill--active">差异</button>
          </div>
        </div>
        <div class="pl-diff">
          <div
            v-for="(l, i) in diffLines"
            :key="i"
            class="pl-line"
            :class="`pl-line--${l.type}`"
          >
            <span class="pl-line__sign">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ' }}</span>
            <span class="pl-line__text">{{ l.text }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ state: 'normal' }>()

const sourceText = `## 角色
你是「目标对话」Skill，负责和用户聊清真实场景。

## 输入
{{user_message}}
{{learner_profile}}

## 要求
1. 先共情，再追问一个具体问题
2. 不评判、不催促
3. 每轮最多提取 3 个概念`

const diffLines = [
  { type: 'same', text: '## 角色' },
  { type: 'same', text: '你是「目标对话」Skill，负责和用户聊清真实场景。' },
  { type: 'same', text: '' },
  { type: 'same', text: '## 输入' },
  { type: 'same', text: '用户：周报要花 3 小时，最烦的是汇总销售表' },
  { type: 'del', text: '{{learner_profile}}' },
  { type: 'add', text: '画像：运营岗 / Excel 中级 / 畏难脚本' },
  { type: 'add', text: '偏好：先看模板再理解原理' },
  { type: 'same', text: '' },
  { type: 'same', text: '## 要求' },
  { type: 'same', text: '1. 先共情，再追问一个具体问题' },
  { type: 'del', text: '2. 不评判、不催促' },
  { type: 'del', text: '3. 每轮最多提取 3 个概念' },
  { type: 'add', text: '2. 不评判、不催促、不甩术语' },
  { type: 'add', text: '3. 每轮最多提取 3 个概念，置信度低于 0.6 要复核' },
  { type: 'add', text: '4. 涉及具体表格结构时，主动给出示例列名' }
]
</script>

<style scoped>
.pl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.pl-pre {
  margin: 0;
  padding: 14px 16px;
  font: 12px/1.7 'JetBrains Mono', Consolas, monospace;
  color: #263950;
  white-space: pre-wrap;
  max-height: 480px;
  overflow: auto;
}
.pl-diff {
  padding: 8px 0 12px;
  font: 12px/1.7 'JetBrains Mono', Consolas, monospace;
  max-height: 480px;
  overflow: auto;
}
.pl-line {
  display: flex;
  gap: 10px;
  padding: 0 14px 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #263950;
}
.pl-line__sign { width: 14px; text-align: center; color: var(--mk-faint); user-select: none; flex-shrink: 0; }
.pl-line--add { background: var(--mk-green-bg); }
.pl-line--add .pl-line__sign,
.pl-line--add .pl-line__text { color: var(--mk-green); }
.pl-line--del { background: var(--mk-red-bg); }
.pl-line--del .pl-line__sign,
.pl-line--del .pl-line__text { color: var(--mk-red); }

@media (max-width: 900px) {
  .pl-grid { grid-template-columns: 1fr; }
}
</style>
