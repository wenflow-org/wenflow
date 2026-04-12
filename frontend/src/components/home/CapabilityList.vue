<template>
  <section class="capability-section">
    <div class="container">
      <div class="section-header fade-in">
        <span class="section-icon">🎯</span>
        <h2 class="section-title">AI 时代需要的 5 种能力</h2>
        <p class="section-subtitle">这些，才是我们培养的。</p>
      </div>

      <div class="capabilities-grid">
        <div 
          class="capability-card fade-in" 
          v-for="(cap, index) in capabilities" 
          :key="index"
          :style="{ transitionDelay: `${index * 0.1}s` }"
        >
          <div class="capability-icon">{{ cap.icon }}</div>
          <h3 class="capability-title">{{ cap.title }}</h3>
          <p class="capability-desc">{{ cap.desc }}</p>
          <div class="capability-vs">
            <span class="vs-label">而非</span>
            <span class="vs-traditional">{{ cap.traditional }}</span>
          </div>
        </div>
      </div>

      <!-- 总结卡片 -->
      <div class="summary-card fade-in">
        <div class="summary-content">
          <span class="summary-icon">✨</span>
          <p class="summary-text">
            <strong>工具会过时，思维永流传。</strong><br />
            当 AI 能解答所有标准问题，<br />
            提出好问题的人，将定义未来。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
const capabilities = [
  {
    icon: '❓',
    title: '问题定义能力',
    desc: '从模糊困惑中提炼出清晰、可探索的问题',
    traditional: '知识记忆'
  },
  {
    icon: '🕸️',
    title: '系统思维能力',
    desc: '看到事物之间的联系和整体结构',
    traditional: '单点解题'
  },
  {
    icon: '⚖️',
    title: '判断力',
    desc: '在信息过载中辨别真伪、权衡取舍',
    traditional: '标准答案'
  },
  {
    icon: '🤖',
    title: 'AI 协作力',
    desc: '与 AI 有效对话，让它成为你的思维伙伴',
    traditional: '独立实现'
  },
  {
    icon: '💡',
    title: '创造力',
    desc: '跨越边界，产生新的连接和可能性',
    traditional: '重复练习'
  }
];
</script>

<style scoped>
.capability-section {
  padding: 8rem 0;
  background: linear-gradient(180deg, transparent 0%, rgba(102, 126, 234, 0.06) 50%, transparent 100%);
  position: relative;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}

.section-header {
  text-align: center;
  margin-bottom: 4.5rem;
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
  font-size: 1.15rem;
  color: var(--color-primary);
  font-weight: 600;
  margin-top: 0.75rem;
}

.capabilities-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 2rem;
  margin-bottom: 4rem;
}

.capability-card {
  grid-column: span 2;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 2.5rem;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  width: 100%;
  box-sizing: border-box;
}

.capability-card:nth-child(4) {
  grid-column: 2 / span 2;
}

.capability-card:nth-child(5) {
  grid-column: 4 / span 2;
}

.capability-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--gradient-primary);
  transform: scaleX(0);
  transition: transform 0.4s ease;
}

.capability-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.15);
  transform: translateY(-8px);
}

.capability-card:hover::before {
  transform: scaleX(1);
}

.capability-icon {
  font-size: 4rem;
  margin-bottom: 1.5rem;
  display: block;
  transition: transform 0.3s ease;
}

.capability-card:hover .capability-icon {
  transform: scale(1.1) rotate(5deg);
}

.capability-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.capability-desc {
  font-size: 1rem;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.capability-vs {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-light);
}

.vs-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
  padding: 0.35rem 0.85rem;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.vs-traditional {
  font-size: 0.95rem;
  color: var(--text-secondary);
  text-decoration: line-through;
  text-decoration-color: #E74C3C;
  text-decoration-thickness: 2px;
}

/* 总结卡片 */
.summary-card {
  background: var(--bg-surface);
  border: 2px solid var(--color-primary);
  border-radius: var(--radius-2xl);
  padding: 3rem 2.5rem;
  text-align: center;
  max-width: 700px;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
}

.summary-card::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, var(--color-primary-light) 0%, transparent 70%);
  animation: rotate-bg 20s linear infinite;
}

@keyframes rotate-bg {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.summary-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.summary-icon {
  font-size: 3.5rem;
  display: block;
  animation: sparkle 2s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
  50% {
    transform: scale(1.2) rotate(10deg);
    opacity: 0.8;
  }
}

.summary-text {
  font-size: 1.25rem;
  color: var(--text-primary);
  line-height: 1.8;
  margin: 0;
}

.summary-text strong {
  color: var(--color-primary);
  font-weight: 800;
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
@media (max-width: 1024px) {
  .capabilities-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }

  .capability-card,
  .capability-card:nth-child(4),
  .capability-card:nth-child(5) {
    grid-column: auto;
  }
}

@media (max-width: 768px) {
  .capability-section {
    padding: 5rem 0;
  }

  .section-title {
    font-size: 1.75rem;
  }

  .capabilities-grid {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .capability-card {
    padding: 2rem;
  }

  .capability-icon {
    font-size: 3rem;
  }

  .summary-card {
    padding: 2rem 1.5rem;
  }

  .summary-text {
    font-size: 1.1rem;
  }
}

/* ========== 可访问性 ========== */
@media (prefers-reduced-motion: reduce) {
  .capability-card::before,
  .summary-card::before,
  .capability-icon,
  .summary-icon {
    animation: none;
    transition: none;
  }
  
  .capability-card:hover .capability-icon {
    transform: none;
  }
}

[data-theme="dark"] .capability-section {
  background: linear-gradient(180deg, transparent 0%, rgba(102, 126, 234, 0.08) 50%, transparent 100%);
}

[data-theme="dark"] .capability-card:hover {
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.25);
}

[data-theme="dark"] .summary-card {
  background: var(--bg-elevated);
}
</style>
