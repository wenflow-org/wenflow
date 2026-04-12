<template>
  <section class="mind-tool-section">
    <div class="container">
      <div class="section-header fade-in">
        <span class="section-icon">🤔</span>
        <h2 class="section-title">我们教什么？</h2>
        <p class="section-subtitle">道与技的区别，思维与工具的本质</p>
      </div>

      <div class="comparison-container fade-in">
        <!-- 思维列（左侧 - 高亮） -->
        <div class="mind-column highlight-column">
          <div class="column-badge">核心</div>
          <div class="column-header">
            <div class="header-icon-wrapper">
              <span class="column-icon">💡</span>
              <div class="icon-glow"></div>
            </div>
            <h3>思维 (道)</h3>
            <p class="header-desc">可迁移的底层能力</p>
          </div>
          <ul class="skill-list">
            <li class="skill-item">
              <span class="skill-icon">🔗</span>
              <span class="skill-text">看到联系</span>
              <span class="skill-detail">识别模式与关联</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">🏗️</span>
              <span class="skill-text">逻辑结构</span>
              <span class="skill-detail">构建系统框架</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">🎯</span>
              <span class="skill-text">工具选择</span>
              <span class="skill-detail">根据场景决策</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">❓</span>
              <span class="skill-text">问题定义</span>
              <span class="skill-detail">从模糊中提炼本质</span>
            </li>
          </ul>
        </div>

        <!-- 中间箭头 -->
        <div class="arrow-divider">
          <div class="arrow-wrapper">
            <span class="arrow">→</span>
            <p class="arrow-text">决定</p>
          </div>
        </div>

        <!-- 工具列（右侧） -->
        <div class="tool-column">
          <div class="column-badge secondary">表现</div>
          <div class="column-header">
            <div class="header-icon-wrapper">
              <span class="column-icon">🔧</span>
            </div>
            <h3>工具 (技)</h3>
            <p class="header-desc">具体场景的应用</p>
          </div>
          <ul class="skill-list">
            <li class="skill-item">
              <span class="skill-icon">💻</span>
              <span class="skill-text">循环怎么写</span>
              <span class="skill-detail">Python/JS 语法</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">📝</span>
              <span class="skill-text">单词怎么拼</span>
              <span class="skill-detail">英语词汇记忆</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">✅</span>
              <span class="skill-text">标准答案</span>
              <span class="skill-detail">应试技巧</span>
            </li>
            <li class="skill-item">
              <span class="skill-icon">📖</span>
              <span class="skill-text">知识记忆</span>
              <span class="skill-detail">知识点背诵</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="key-insight fade-in">
        <div class="insight-icon">✨</div>
        <p class="insight-text">
          "有了思维，你自然会用好任何工具。"
        </p>
        <p class="insight-sub">
          工具会过时，思维永流传
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
</script>

<style scoped>
.mind-tool-section {
  padding: 8rem 0;
  background: linear-gradient(180deg, transparent 0%, rgba(103, 194, 58, 0.06) 50%, transparent 100%);
  position: relative;
}

.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2rem;
}

.section-header {
  text-align: center;
  margin-bottom: 4rem;
}

.section-icon {
  font-size: 3.5rem;
  display: block;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  letter-spacing: -0.02em;
}

.section-subtitle {
  font-size: 1.1rem;
  color: var(--text-secondary);
  font-weight: 400;
}

/* 对比容器 */
.comparison-container {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 2.5rem;
  align-items: stretch;
  justify-content: center;
  max-width: 1000px;
  margin: 0 auto 4rem;
  position: relative;
}

/* 列通用样式 */
.mind-column,
.tool-column {
  background: var(--bg-surface);
  border: 2px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 2.5rem;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.mind-column {
  border-color: var(--color-primary);
  background: var(--bg-surface);
  box-shadow: 0 8px 32px rgba(102, 126, 234, 0.12);
}

.tool-column {
  border-color: var(--border-default);
  background: var(--bg-surface);
}

/* 高亮列增强效果 - 移除顶部横线，改用边框强调 */
.highlight-column {
  border-width: 3px;
}

.highlight-column:hover {
  transform: translateY(-8px);
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.2);
}

.tool-column:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
}

/* 列徽章 */
.column-badge {
  position: absolute;
  top: -12px;
  right: 24px;
  padding: 0.4rem 1rem;
  background: var(--gradient-primary);
  color: white;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.column-badge.secondary {
  background: var(--bg-muted);
  color: var(--text-secondary);
  box-shadow: none;
}

/* 列头部 */
.column-header {
  text-align: center;
  margin-bottom: 2.5rem;
  padding-bottom: 2rem;
  border-bottom: 2px solid var(--border-light);
}

.header-icon-wrapper {
  position: relative;
  display: inline-block;
  margin-bottom: 1rem;
}

.column-icon {
  font-size: 3.5rem;
  display: block;
  position: relative;
  z-index: 1;
}

/* 图标光晕效果 */
.icon-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80px;
  height: 80px;
  background: radial-gradient(circle, rgba(102, 126, 234, 0.3) 0%, transparent 70%);
  border-radius: 50%;
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% {
    opacity: 0.5;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
  opacity: 1;
    transform: translate(-50%, -50%) scale(1.2);
  }
}

.column-header h3 {
  font-size: 1.75rem;
  font-weight: 800;
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.mind-column .column-header h3 {
  color: var(--color-primary);
}

.header-desc {
  font-size: 0.95rem;
  color: var(--text-muted);
  margin: 0;
  font-weight: 500;
}

/* 技能列表 */
.skill-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--border-light);
  transition: all 0.3s ease;
}

.skill-item:last-child {
  border-bottom: none;
}

.skill-item:hover {
  transform: translateX(12px);
  background: rgba(102, 126, 234, 0.03);
  margin: 0 -1rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: var(--radius-lg);
}

.skill-icon {
  font-size: 1.75rem;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-muted);
  border-radius: 50%;
  flex-shrink: 0;
}

.mind-column .skill-icon {
  background: var(--color-primary-light);
}

.skill-text {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 100px;
}

.skill-detail {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin-left: auto;
  padding-left: 1rem;
}

/* 箭头分隔符 */
.arrow-divider {
  display: flex;
  align-items: center;
  justify-content: center;
}

.arrow-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.arrow {
  font-size: 3rem;
  color: var(--color-primary);
  font-weight: 700;
  animation: slide-right 2s ease-in-out infinite;
}

@keyframes slide-right {
  0%, 100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(8px);
  }
}

.arrow-text {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* 关键洞察 */
.key-insight {
  text-align: center;
  padding: 3rem 2.5rem;
  background: var(--bg-surface);
  border: 2px solid var(--color-primary);
  border-radius: var(--radius-2xl);
  max-width: 650px;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
}

.key-insight::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, var(--color-primary-light) 0%, transparent 70%);
  animation: rotate-bg 10s linear infinite;
}

@keyframes rotate-bg {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.insight-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
  position: relative;
  z-index: 1;
}

.insight-text {
  font-size: 1.35rem;
  color: var(--text-primary);
  font-weight: 700;
  margin: 0 0 0.75rem 0;
  font-style: italic;
  position: relative;
  z-index: 1;
}

.insight-sub {
  font-size: 1rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin: 0;
  position: relative;
  z-index: 1;
}

/* ========== 动画 ========== */
.fade-in {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}

/* ========== 响应式 ========== */
@media (max-width: 968px) {
  .comparison-container {
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .arrow-divider {
    padding: 1rem 0;
  }

  .arrow {
    transform: rotate(90deg);
    font-size: 2.5rem;
    animation: none;
  }

  .mind-column,
  .tool-column {
    text-align: center;
  }

  .skill-item {
    justify-content: center;
    text-align: left;
  }

  .skill-item:hover {
    transform: translateY(-4px);
    margin: 0;
    padding: 1.25rem;
  }

  .skill-detail {
    display: none;
  }

  .key-insight {
    padding: 2rem 1.5rem;
  }

  .insight-text {
    font-size: 1.15rem;
  }
}

/* ========== 可访问性 ========== */
@media (prefers-reduced-motion: reduce) {
  .icon-glow,
  .arrow,
  .key-insight::before {
    animation: none;
  }
  
  .skill-item,
  .mind-column,
  .tool-column {
    transition: none;
  }
}

[data-theme="dark"] .mind-tool-section {
  background: linear-gradient(180deg, transparent 0%, rgba(103, 194, 58, 0.08) 50%, transparent 100%);
}

[data-theme="dark"] .mind-column:hover {
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.3);
}

[data-theme="dark"] .tool-column:hover {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

[data-theme="dark"] .skill-item:hover {
  background: var(--bg-muted);
}
</style>