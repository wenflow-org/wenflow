<template>
  <section class="einstein-section">
    <div class="container">
      <div class="section-header fade-in">
        <span class="section-icon">📜</span>
        <h2 class="section-title">一封被遗忘的电报</h2>
        <p class="section-subtitle">1946.5.25 - 爱因斯坦等科学家致联合国</p>
      </div>

      <!-- 爱因斯坦警告 -->
      <div class="einstein-warning fade-in">
        <div class="warning-header">
          <el-icon><Document /></el-icon>
          <span>1946 年，爱因斯坦等科学家警告</span>
        </div>
        
        <blockquote class="quote-block">
          <p>"原子释放出的力量改变了一切，<br />除了我们的思维方式。"</p>
          <cite>—— 爱因斯坦等科学家，1946 年</cite>
        </blockquote>
        
        <div class="timeline-divider">
          <span class="timeline-line"></span>
          <span class="timeline-text">80 年过去了</span>
          <span class="timeline-line"></span>
        </div>
        
        <div class="modern-response">
          <p class="response-title">2026 年，AI 释放的力量不亚于原子能。</p>
          <p class="response-subtitle">但我们的教育，还在用工业时代的方式。</p>
          <p class="response-punchline">历史，正在重演。</p>
        </div>
      </div>

      <div class="divider fade-in">
        <div class="divider-line"></div>
        <div class="divider-text">我们选择另一条路</div>
        <div class="divider-line"></div>
      </div>

      <div class="modern-context fade-in">
        <div class="comparison-grid">
          <div class="comparison-column wrong-way">
            <div class="column-header">
              <span class="header-icon">❌</span>
              <h3>旧方式</h3>
            </div>
            <ul class="feature-list">
              <li>
                <span class="list-icon">✕</span>
                <span>用 AI 提高传统学习效率</span>
              </li>
              <li>
                <span class="list-icon">✕</span>
                <span>让学生更快记住更多知识</span>
              </li>
              <li>
                <span class="list-icon">✕</span>
                <span>AI 辅助应试</span>
              </li>
            </ul>
          </div>

          <div class="comparison-column right-way">
            <div class="column-header">
              <span class="header-icon">✅</span>
              <h3>新思维</h3>
            </div>
            <ul class="feature-list">
              <li>
                <span class="list-icon">✓</span>
                <span>培养"新的思维方式"</span>
              </li>
              <li>
                <span class="list-icon">✓</span>
                <span>用 AI 培养 AI 时代需要的能力</span>
              </li>
              <li>
                <span class="list-icon">✓</span>
                <span>让教育跟上技术变革</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Document } from '@element-plus/icons-vue';
</script>

<style scoped>
.einstein-section {
  padding: 8rem 0;
  background: linear-gradient(180deg, transparent 0%, rgba(102, 126, 234, 0.08) 50%, transparent 100%);
  position: relative;
}

.container {
  max-width: 1000px;
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
  font-size: 1rem;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* ========== 爱因斯坦警告区域 ========== */
.einstein-warning {
  max-width: 800px;
  margin: 4rem auto;
  padding: 3rem;
  background: var(--bg-surface);
  border-top: 3px solid #ff6b6b;
  border-radius: 16px;
  text-align: center;
}

.warning-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 2rem;
}

.warning-header .el-icon {
  font-size: 1.25rem;
  color: var(--color-primary);
}

.quote-block {
  position: relative;
  padding: 0 3rem;
  margin-bottom: 3rem;
  border-left: none;
}

.quote-block::before {
  content: '"';
  position: absolute;
  left: 50%;
  top: -2.5rem;
  transform: translateX(-50%);
  font-size: 5rem;
  color: var(--text-muted);
  opacity: 0.15;
  font-family: Georgia, serif;
  line-height: 1;
}

.quote-block p {
  font-size: 1.5rem;
  line-height: 1.8;
  color: var(--text-primary);
  margin-bottom: 1rem;
  font-family: Georgia, serif;
  font-weight: 500;
}

.quote-block cite {
  display: block;
  font-style: italic;
  color: var(--text-secondary);
  font-size: 1rem;
  font-weight: 600;
}

/* 时间线分隔符 */
.timeline-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  margin: 3rem 0;
  position: relative;
}

.timeline-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(102, 126, 234, 0.4), transparent);
  min-width: 80px;
}

.timeline-text {
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.8rem;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* 现代回应 */
.modern-response {
  text-align: center;
  padding: 2rem;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 12px;
}

.response-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.response-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

.response-punchline {
  font-size: 1.25rem;
  font-weight: 700;
  color: #ff6b6b;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin: 0;
}

/* ========== 分隔线 ========== */
.divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  margin: 4rem auto;
  max-width: 350px;
  position: relative;
}

.divider-line {
  flex: 1;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  min-width: 80px;
}

.divider-text {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

/* ========== 现代语境对比 ========== */
.modern-context {
  text-align: center;
}

.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2.5rem;
  max-width: 850px;
  margin: 0 auto;
}

.comparison-column {
  background: var(--bg-surface);
  border: 2px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 2.5rem;
  text-align: left;
  transition: all 0.3s ease;
}

.wrong-way {
  border-color: #E74C3C;
  background: linear-gradient(135deg, rgba(231, 76, 60, 0.03) 0%, transparent 100%);
}

.right-way {
  border-color: #27AE60;
  background: linear-gradient(135deg, rgba(39, 174, 96, 0.05) 0%, transparent 100%);
  position: relative;
  overflow: hidden;
}

.right-way::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: #27AE60;
}

.comparison-column:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
}

.column-header {
  text-align: center;
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 2px solid var(--border-light);
}

.header-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 0.5rem;
}

.column-header h3 {
  font-size: 1.5rem;
  font-weight: 800;
  margin: 0;
}

.wrong-way .column-header h3 {
  color: #E74C3C;
}

.right-way .column-header h3 {
  color: #27AE60;
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feature-list li {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  font-size: 1.05rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
  transition: all 0.2s ease;
}

.feature-list li:last-child {
  border-bottom: none;
}

.feature-list li:hover {
  transform: translateX(8px);
  color: var(--text-primary);
}

.list-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.wrong-way .list-icon {
  background: rgba(231, 76, 60, 0.1);
  color: #E74C3C;
}

.right-way .list-icon {
  background: rgba(39, 174, 96, 0.1);
  color: #27AE60;
}

.column-cta {
  margin-top: 2rem;
  text-align: center;
}

.btn-outline-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 1.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: var(--radius-full);
  text-decoration: none;
  transition: all 0.3s ease;
  border: 2px solid #27AE60;
  color: #27AE60;
  background: transparent;
}

.btn-outline-sm:hover {
  background: #27AE60;
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(39, 174, 96, 0.3);
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
@media (max-width: 768px) {
  .einstein-section {
    padding: 5rem 0;
  }

  .section-title {
    font-size: 1.75rem;
  }

  .einstein-warning {
    padding: 2rem 1.5rem;
    margin: 2rem auto;
  }

  .quote-block {
    padding-left: 1.5rem;
  }

  .quote-block p {
    font-size: 1.1rem;
  }

  .timeline-divider {
    flex-direction: column;
    gap: 0.5rem;
  }

  .timeline-line {
    width: 100%;
    max-width: 200px;
  }

  .modern-response {
    padding: 1.5rem;
  }

  .response-title {
    font-size: 1rem;
  }

  .response-subtitle {
    font-size: 0.95rem;
  }

  .response-punchline {
    font-size: 1.1rem;
    letter-spacing: 1px;
  }

  .comparison-grid {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .comparison-column {
    text-align: center;
  }

  .column-header {
    text-align: center;
  }

  .feature-list li {
    justify-content: center;
  }

  .divider {
    flex-direction: column;
    gap: 0.5rem;
  }

  .divider-line {
    width: 100%;
    max-width: 200px;
  }
}

/* ========== 可访问性 ========== */
@media (prefers-reduced-motion: reduce) {
  .comparison-column,
  .feature-list li {
    transition: none;
  }
  
  .comparison-column:hover {
    transform: none;
  }
}

[data-theme="dark"] .einstein-section {
  background: linear-gradient(180deg, transparent 0%, rgba(102, 126, 234, 0.12) 50%, transparent 100%);
}

[data-theme="dark"] .comparison-column:hover {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
</style>