<template>
  <section class="problem-creator-section">
    <div class="container">
      <div class="section-header fade-in">
        <span class="section-icon">💡</span>
        <h2 class="section-title">
          世上最难的问题，<br />
          <span class="highlight-sub">是自己给自己出的题。</span>
        </h2>
        <p class="section-subtitle">两种问题，两种完全不同的体验</p>
      </div>

      <div class="comparison-table-wrapper fade-in">
        <div class="comparison-table">
          <!-- 表头 -->
          <div class="table-header">
            <div class="header-cell given">
              <div class="header-content">
                <span class="header-emoji">📋</span>
                <h3>别人给的问题</h3>
                <p class="header-desc">学校、考试、培训</p>
              </div>
            </div>
            <div class="header-cell created">
              <div class="header-content">
                <span class="header-emoji">🌟</span>
                <h3>你创建的问题</h3>
                <p class="header-desc">探索、研究、创业</p>
              </div>
            </div>
          </div>

          <!-- 表体 -->
          <div class="table-body">
            <!-- Row 1 -->
            <div class="table-row">
              <div class="cell given">
                <div class="cell-content">
                  <span class="cell-emoji">📋</span>
                  <div class="cell-text">
                    <strong>再难也有解法</strong>
                    <span class="cell-detail">出题人设计好的路径</span>
                  </div>
                </div>
              </div>
              <div class="cell created">
                <div class="cell-content">
                  <span class="cell-emoji">🌑</span>
                  <div class="cell-text">
                    <strong>没有标准答案</strong>
                    <span class="cell-detail">你需要自己定义什么是"好"</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 2 -->
            <div class="table-row">
              <div class="cell given">
                <div class="cell-content">
                  <span class="cell-emoji">✍️</span>
                  <div class="cell-text">
                    <strong>出题人知道答案</strong>
                    <span class="cell-detail">有人能告诉你对错</span>
                  </div>
                </div>
              </div>
              <div class="cell created">
                <div class="cell-content">
                  <span class="cell-emoji">🔍</span>
                  <div class="cell-text">
                    <strong>没有明确边界</strong>
                    <span class="cell-detail">问题会不断演变和扩展</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 3 -->
            <div class="table-row">
              <div class="cell given">
                <div class="cell-content">
                  <span class="cell-emoji">🛤️</span>
                  <div class="cell-text">
                    <strong>有标准路径</strong>
                    <span class="cell-detail">教材、课程、练习册</span>
                  </div>
                </div>
              </div>
              <div class="cell created">
                <div class="cell-content">
                  <span class="cell-emoji">🌫️</span>
                  <div class="cell-text">
                    <strong>黑暗中摸索</strong>
                    <span class="cell-detail">没有人告诉你下一步</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 4 -->
            <div class="table-row">
              <div class="cell given">
                <div class="cell-content">
                  <span class="cell-emoji">✅</span>
                  <div class="cell-text">
                    <strong>可以答对/答错</strong>
                    <span class="cell-detail">明确的评判标准</span>
                  </div>
                </div>
              </div>
              <div class="cell created">
                <div class="cell-content">
                  <span class="cell-emoji">📈</span>
                  <div class="cell-text">
                    <strong>只有更理解</strong>
                    <span class="cell-detail">没有终点，只有更深</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 关键洞察 -->
      <div class="insight-card fade-in">
        <div class="insight-content">
          <span class="insight-icon">🎯</span>
          <p class="insight-text">
            <strong>真正有价值的成长</strong>，发生在没有标准答案的地方。
          </p>
        </div>
      </div>

      <!-- CTA -->
      <div class="cta-container fade-in">
        <router-link :to="ctaPath" class="btn btn-primary btn-lg btn-glow">
          🚀 {{ ctaLabel }}
        </router-link>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const isLoggedIn = ref(false);

const syncAuthState = () => {
  isLoggedIn.value = Boolean(localStorage.getItem('token'));
};

const ctaPath = computed(() => (isLoggedIn.value ? '/goal-conversation' : '/register'));
const ctaLabel = computed(() => (isLoggedIn.value ? '继续创建你的问题' : '注册后开始创建你的第一个问题'));

onMounted(() => {
  syncAuthState();
  window.addEventListener('storage', syncAuthState);
});

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState);
});
</script>

<style scoped>
.problem-creator-section {
  padding: 8rem 0;
  background: linear-gradient(180deg, transparent 0%, rgba(230, 126, 34, 0.06) 50%, transparent 100%);
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
  line-height: 1.3;
  letter-spacing: -0.02em;
}

.section-title .highlight-sub {
  display: block;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}

.section-subtitle {
  font-size: 1.1rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-top: 0.75rem;
}

/* 对比表格包装器 */
.comparison-table-wrapper {
  margin-bottom: 3rem;
  perspective: 1000px;
}

.comparison-table {
  background: var(--bg-surface);
  border: 2px solid var(--border-default);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  transition: all 0.4s ease;
}

.comparison-table:hover {
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.12);
}

/* 表头 */
.table-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.header-cell {
  padding: 2.5rem 2rem;
  text-align: center;
  border-bottom: 3px solid rgba(102, 126, 234, 0.3);
  transition: all 0.3s ease;
}

.header-cell.given {
  background: var(--bg-muted);
  border-right: 3px solid rgba(102, 126, 234, 0.3);
}

.header-cell.created {
  background: var(--bg-muted);
}

.header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.header-emoji {
  font-size: 3rem;
  display: block;
}

.header-cell h3 {
  font-size: 1.5rem;
  font-weight: 800;
  margin: 0;
}

.header-cell.given h3,
.header-cell.created h3 {
  color: var(--text-primary);
}

.header-desc {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin: 0;
}

/* 表体 */
.table-body {
  display: flex;
  flex-direction: column;
}

.table-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 2px solid rgba(102, 126, 234, 0.15);
  transition: all 0.3s ease;
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background: var(--bg-muted);
}

.cell {
  padding: 1.75rem 2rem;
  transition: all 0.3s ease;
}

.cell.given {
  border-right: 2px solid rgba(102, 126, 234, 0.25);
}

.cell-content {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.cell-emoji {
  font-size: 2rem;
  flex-shrink: 0;
}

.cell-text {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.cell-text strong {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.cell-detail {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.4;
}

/* 关键洞察卡片 */
.insight-card {
  background: var(--bg-surface);
  border: 2px solid #e67e22;
  border-radius: var(--radius-2xl);
  padding: 2.5rem;
  text-align: center;
  max-width: 700px;
  margin: 0 auto 3rem;
  position: relative;
  overflow: hidden;
}

.insight-card::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, var(--color-accent-light) 0%, transparent 70%);
  animation: rotate-bg 15s linear infinite;
}

@keyframes rotate-bg {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.insight-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.insight-icon {
  font-size: 3rem;
  display: block;
}

.insight-text {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.6;
}

.insight-text strong {
  color: #e67e22;
  font-weight: 800;
}

/* CTA 容器 */
.cta-container {
  text-align: center;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.25rem 3rem;
  font-weight: 600;
  font-size: 1.1rem;
  border-radius: var(--radius-full);
  text-decoration: none;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: var(--gradient-primary);
  color: white;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.btn-primary:hover {
  box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
  transform: translateY(-2px);
}

.btn-lg {
  padding: 1.25rem 3rem;
  font-size: 1.1rem;
}

.btn-glow {
  animation: glow 3s ease-in-out infinite;
}

@keyframes glow {
  0%, 100% {
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  }
  50% {
    box-shadow: 0 4px 25px rgba(102, 126, 234, 0.6);
  }
}

.btn-icon {
  font-size: 1.5rem;
}

.cta-note {
  margin-top: 1rem;
  font-size: 0.9rem;
  color: var(--text-muted);
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
  .problem-creator-section {
    padding: 5rem 0;
  }

  .section-title {
    font-size: 1.75rem;
  }

  .section-title .highlight-sub {
    font-size: 1rem;
  }

  .table-header,
  .table-row {
    grid-template-columns: 1fr;
  }

  .header-cell,
  .cell.given {
    border-right: none;
    border-bottom: 2px solid var(--border-default);
  }

  .header-cell {
    padding: 2rem 1.5rem;
  }

  .cell {
    padding: 1.5rem;
  }

  .cell-content {
    justify-content: center;
    text-align: center;
  }

  .insight-card {
    padding: 2rem 1.5rem;
  }

  .insight-text {
    font-size: 1.1rem;
  }

  .btn {
    width: 100%;
    justify-content: center;
  }
}

/* ========== 可访问性 ========== */
@media (prefers-reduced-motion: reduce) {
  .comparison-table,
  .table-row,
  .cell,
  .insight-card::before {
    transition: none;
  }
  
  .insight-card::before {
    animation: none;
  }
}

[data-theme="dark"] .problem-creator-section {
  background: linear-gradient(180deg, transparent 0%, rgba(230, 126, 34, 0.08) 50%, transparent 100%);
}

[data-theme="dark"] .comparison-table:hover {
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
}

[data-theme="dark"] .comparison-table {
  border-color: var(--border-default);
}
</style>
