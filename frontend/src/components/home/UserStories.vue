<template>
  <section class="user-stories-section">
    <div class="container">
      <div class="section-header fade-in">
        <span class="section-icon">💬</span>
        <h2 class="section-title">他们在这里发现了什么</h2>
        <p class="section-subtitle">从"被动接受"到"主动探索"的转变</p>
      </div>

      <div class="stories-grid">
        <div 
          class="story-card fade-in" 
          v-for="(story, index) in stories" 
          :key="index"
          :style="{ transitionDelay: `${index * 0.1}s` }"
        >
          <div class="story-rating">{{ story.rating }}</div>
          <p class="story-text">"{{ story.text }}"</p>
          <div class="story-author">
            <div class="author-avatar">{{ story.avatar }}</div>
            <div class="author-info">
              <div class="author-name">{{ story.name }}</div>
              <div class="author-meta">{{ story.meta }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div class="cta-container fade-in">
        <a href="#footer" class="btn btn-outline-lg">
          <span class="btn-icon">🌟</span>
          加入他们，开始你的思维之旅
        </a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
const stories = [
  {
    rating: '⭐⭐⭐⭐⭐',
    text: '以前我总是在找"正确答案"。在这里，我学会了问"更好的问题"。',
    avatar: '👨‍💻',
    name: '小明',
    meta: '学习 Python 3 个月'
  },
  {
    rating: '⭐⭐⭐⭐⭐',
    text: 'AI 不会直接给我答案，它会问我："你觉得呢？" 一开始很不习惯，现在反而觉得这才是真正的学习。',
    avatar: '👩‍🎨',
    name: '小红',
    meta: '学习 UI 设计 6 个月'
  },
  {
    rating: '⭐⭐⭐⭐⭐',
    text: '现在遇到任何问题，我都会先问自己：这真正的问题是什么？这个习惯改变了我的工作方式。',
    avatar: '👨‍💼',
    name: '张先生',
    meta: '学习新媒体运营 4 个月'
  },
  {
    rating: '⭐⭐⭐⭐⭐',
    text: '以前学习是"老师要我学"，现在是"我自己要搞懂"。这种转变，只有经历过才知道有多大的力量。',
    avatar: '👩‍🔬',
    name: '李女士',
    meta: '学习心理学 5 个月'
  }
];
</script>

<style scoped>
.user-stories-section {
  padding: 8rem 0;
  background: linear-gradient(180deg, transparent 0%, rgba(230, 126, 34, 0.06) 50%, transparent 100%);
  position: relative;
}

.container {
  max-width: 1100px;
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
  font-size: 1.1rem;
  color: var(--text-secondary);
  font-weight: 400;
  margin-top: 0.75rem;
}

.stories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 2rem;
  margin-bottom: 4rem;
}

.story-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 2.5rem;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.story-card::before {
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

.story-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.15);
  transform: translateY(-8px);
}

.story-card:hover::before {
  transform: scaleX(1);
}

.story-rating {
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
  letter-spacing: 0.25rem;
  line-height: 1;
}

.story-text {
  font-size: 1.05rem;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 2rem;
  font-style: italic;
  min-height: 80px;
}

.story-author {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-light);
}

.author-avatar {
  font-size: 3rem;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: 50%;
  flex-shrink: 0;
}

.author-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.author-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.author-meta {
  font-size: 0.9rem;
  color: var(--text-muted);
}

/* CTA 容器 */
.cta-container {
  text-align: center;
}

.btn-outline-lg {
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
  border: 2px solid var(--color-primary);
  color: var(--color-primary);
  background: transparent;
}

.btn-outline-lg:hover {
  background: var(--color-primary);
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
}

.btn-icon {
  font-size: 1.5rem;
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
  .user-stories-section {
    padding: 5rem 0;
  }

  .section-title {
    font-size: 1.75rem;
  }

  .stories-grid {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .story-card {
    padding: 2rem;
  }

  .story-text {
    min-height: auto;
  }

  .btn-outline-lg {
    width: 100%;
  }
}

/* ========== 可访问性 ========== */
@media (prefers-reduced-motion: reduce) {
  .story-card::before,
  .story-card:hover {
    transition: none;
    transform: none;
  }
}

[data-theme="dark"] .user-stories-section {
  background: linear-gradient(180deg, transparent 0%, rgba(230, 126, 34, 0.08) 50%, transparent 100%);
}

[data-theme="dark"] .story-card:hover {
  box-shadow: 0 16px 48px rgba(102, 126, 234, 0.25);
}

[data-theme="dark"] .btn-outline-lg:hover {
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
}
</style>