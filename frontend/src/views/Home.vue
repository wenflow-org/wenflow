<template>
  <div class="home-page">
    <!-- 滚动进度条 -->
    <div class="scroll-progress" :style="{ width: scrollProgress + '%' }"></div>

    <!-- 动态背景 -->
      <div class="animated-bg">
        <div class="gradient-orb gradient-orb-1"></div>
        <div class="gradient-orb gradient-orb-2"></div>
        <div class="gradient-orb gradient-orb-3"></div>
        <!-- 粒子效果 -->
        <div class="particles">
          <div v-for="(style, index) in particleStyles" :key="index" class="particle" :style="style"></div>
        </div>
      </div>

    <!-- 导航栏 -->
    <header class="navbar" :class="{ 'navbar-scrolled': scrolled }">
      <div class="container navbar-container">
        <div class="navbar-brand">
          <router-link to="/" class="brand-link">
            <img src="/logo.png" alt="WenFlow Logo" class="brand-logo-img" />
            <span class="brand-text">问流 WenFlow</span>
          </router-link>
        </div>
        
        <!-- 桌面导航 -->
        <nav class="navbar-nav" :class="{ 'nav-open': mobileNavOpen }">
          <a href="#einstein" class="nav-link" :class="{ 'nav-link-active': activeSection === 'einstein' }">理念</a>
          <a href="#problem-creator" class="nav-link" :class="{ 'nav-link-active': activeSection === 'problem-creator' }">问题意识</a>
          <a href="#capabilities" class="nav-link" :class="{ 'nav-link-active': activeSection === 'capabilities' }">核心能力</a>
          <a href="https://github.com/wenflow-org/wenflow" class="nav-link" target="_blank">GitHub</a>
        </nav>

        <!-- 桌面操作区 -->
        <div class="navbar-actions">
          <ThemeSwitcher />
          <template v-if="isLoggedIn">
            <router-link to="/goal-conversation" class="btn btn-primary">
              进入规划
            </router-link>
            <router-link to="/dashboard" class="btn btn-secondary">
              我的学习台
            </router-link>
          </template>
          <template v-else>
            <router-link to="/register" class="btn btn-primary">
              开始体验
            </router-link>
            <router-link to="/login" class="btn btn-secondary">
              登录
            </router-link>
          </template>
        </div>

        <!-- 移动端汉堡菜单 -->
        <button class="mobile-menu-btn" @click="toggleMobileNav" :aria-label="mobileNavOpen ? '关闭菜单' : '打开菜单'">
          <span class="hamburger" :class="{ 'hamburger-open': mobileNavOpen }">
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
          </span>
        </button>
      </div>

      <!-- 移动端下拉菜单 -->
      <div class="mobile-nav-dropdown" :class="{ 'dropdown-open': mobileNavOpen }">
        <a href="#einstein" class="mobile-nav-link" :class="{ 'mobile-nav-link-active': activeSection === 'einstein' }" @click="closeMobileNav">理念</a>
        <a href="#problem-creator" class="mobile-nav-link" :class="{ 'mobile-nav-link-active': activeSection === 'problem-creator' }" @click="closeMobileNav">问题意识</a>
        <a href="#capabilities" class="mobile-nav-link" :class="{ 'mobile-nav-link-active': activeSection === 'capabilities' }" @click="closeMobileNav">核心能力</a>
        <a href="https://github.com/wenflow-org/wenflow" class="mobile-nav-link" target="_blank" @click="closeMobileNav">GitHub</a>
        <div class="mobile-nav-actions">
          <template v-if="isLoggedIn">
            <router-link to="/goal-conversation" class="btn btn-primary" @click="closeMobileNav">
              进入规划
            </router-link>
            <router-link to="/dashboard" class="btn btn-secondary" @click="closeMobileNav">
              我的学习台
            </router-link>
          </template>
          <template v-else>
            <router-link to="/register" class="btn btn-primary" @click="closeMobileNav">
              开始体验
            </router-link>
            <router-link to="/login" class="btn btn-secondary" @click="closeMobileNav">
              登录
            </router-link>
          </template>
        </div>
      </div>
    </header>

    <!-- Hero 区域 - 颠覆性开场 -->
    <section class="hero">
      <div class="container hero-container">
        <div class="hero-content fade-in">
          <div class="hero-badge">
            <span class="badge-dot"></span>
            <span>为想解决真问题的人准备</span>
          </div>

          <h1 class="hero-title">
            <span class="hero-title-line">想学的东西很多</span>
            <span class="hero-title-line highlight">先把真正的问题想清楚</span>
          </h1>
          
          <p class="hero-subtitle">
            <strong>问流帮你把模糊目标拆成可执行路径。</strong>
            先想清要解决什么，再进入 AI 规划、对话学习和进度追踪，少走弯路。
          </p>

          <div class="hero-cta">
            <div class="cta-buttons">
              <router-link :to="primaryCtaPath" class="btn btn-primary btn-lg btn-glow">
                <span class="btn-icon">🚀</span>
                {{ primaryCtaLabel }}
              </router-link>
              <a href="#einstein" class="btn btn-outline btn-lg">
                先了解理念
              </a>
            </div>

            <div class="hero-proof">
              <div class="proof-item">
                <strong>目标拆解</strong>
                <span>把“想学”变成一条学习路径</span>
              </div>
              <div class="proof-item">
                <strong>AI 对话学习</strong>
                <span>边学边问，围绕你的真实问题推进</span>
              </div>
              <div class="proof-item">
                <strong>学习状态追踪</strong>
                <span>看到节奏、疲劳和长期积累</span>
              </div>
            </div>

            <div class="scroll-hint">
              <span>往下看，先判断这是不是适合你的学习方式</span>
              <div class="scroll-arrow">↓</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 1: 爱因斯坦的警告 -->
    <div id="einstein">
      <EinsteinQuote />
    </div>

    <!-- Section 2: 思维 vs 工具 -->
    <MindVsTool />

    <!-- Section 3: 问题创建 -->
    <div id="problem-creator">
      <ProblemCreator />
    </div>

    <!-- Section 4: 核心能力 -->
    <div id="capabilities">
      <CapabilityList />
    </div>

    <!-- Footer: 邀请 -->
    <footer id="footer" class="footer-section">
      <div class="container">
        <div class="footer-content fade-in">
          <div class="footer-quote">
            <p class="quote-main">
              "当 AI 在学怎么像人一样思考，<br />
              我们在教人怎么更会思考。"
            </p>
            <p class="quote-sub">
              当它们相遇，就是未来。
            </p>
          </div>

          <div class="footer-cta">
            <router-link :to="primaryCtaPath" class="btn btn-primary btn-lg btn-glow">
              🚀 {{ footerCtaLabel }}
            </router-link>
          </div>

          <div class="footer-links">
            <a href="#einstein">理念</a>
            <a href="#problem-creator">问题意识</a>
            <a href="#capabilities">核心能力</a>
            <a href="https://github.com/wenflow-org/wenflow" target="_blank">GitHub</a>
          </div>

          <div class="footer-bottom">
            <p>© 2026 问流 WenFlow · 你的学习伙伴</p>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import EinsteinQuote from '@/components/home/EinsteinQuote.vue';
import MindVsTool from '@/components/home/MindVsTool.vue';
import ProblemCreator from '@/components/home/ProblemCreator.vue';
import CapabilityList from '@/components/home/CapabilityList.vue';
import ThemeSwitcher from '@/components/ThemeSwitcher.vue';

interface ParticleStyle {
  width: string;
  height: string;
  left: string;
  top: string;
  animationDelay: string;
  animationDuration: string;
}

const scrolled = ref(false);
const mobileNavOpen = ref(false);
const scrollProgress = ref(0);
const particleStyles = ref<ParticleStyle[]>([]);
const isLoggedIn = ref(false);
const activeSection = ref<'einstein' | 'problem-creator' | 'capabilities'>('einstein');
let scrollObserver: IntersectionObserver | null = null;
let sectionObserver: IntersectionObserver | null = null;

const primaryCtaPath = computed(() => (isLoggedIn.value ? '/goal-conversation' : '/register'));
const primaryCtaLabel = computed(() => (isLoggedIn.value ? '进入目标规划' : '开始体验'));
const footerCtaLabel = computed(() => (isLoggedIn.value ? '继续你的目标规划' : '开始你的第一次目标规划'));

const syncAuthState = () => {
  isLoggedIn.value = Boolean(localStorage.getItem('token'));
};

const handleScroll = () => {
  scrolled.value = window.scrollY > 50;

  // 计算滚动进度
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  scrollProgress.value = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
};

// 切换移动端导航
const toggleMobileNav = () => {
  mobileNavOpen.value = !mobileNavOpen.value;
  document.body.style.overflow = mobileNavOpen.value ? 'hidden' : '';
};

// 关闭移动端导航
const closeMobileNav = () => {
  mobileNavOpen.value = false;
  document.body.style.overflow = '';
};

// 粒子效果样式
const createParticleStyle = (): ParticleStyle => {
  const size = Math.random() * 4 + 2;
  const left = Math.random() * 100;
  const top = Math.random() * 100;
  const delay = Math.random() * 20;
  const duration = Math.random() * 10 + 15;

  return {
    width: `${size}px`,
    height: `${size}px`,
    left: `${left}%`,
    top: `${top}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`
  };
};

// 滚动动画
const setupScrollAnimation = () => {
  scrollObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    {
      threshold: 0.3,
      rootMargin: '0px 0px -50px 0px'
    }
  );

  document.querySelectorAll('.fade-in').forEach((el) => {
    scrollObserver?.observe(el);
  });
};

const setupSectionTracking = () => {
  sectionObserver = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visibleEntries.length > 0) {
        activeSection.value = visibleEntries[0].target.id as 'einstein' | 'problem-creator' | 'capabilities';
      }
    },
    {
      threshold: [0.2, 0.4, 0.6],
      rootMargin: '-25% 0px -45% 0px'
    }
  );

  ['einstein', 'problem-creator', 'capabilities'].forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      sectionObserver?.observe(section);
    }
  });
};

onMounted(() => {
  syncAuthState();
  window.addEventListener('storage', syncAuthState);

  particleStyles.value = Array.from({ length: 20 }, () => createParticleStyle());
  window.addEventListener('scroll', handleScroll);
  handleScroll();
  setupScrollAnimation();
  setupSectionTracking();

  // 初始动画
  setTimeout(() => {
    document.querySelectorAll('.hero .fade-in').forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('visible');
      }, i * 150);
    });
  }, 100);
});

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState);
  window.removeEventListener('scroll', handleScroll);
  scrollObserver?.disconnect();
  sectionObserver?.disconnect();
  document.body.style.overflow = '';
});
</script>

<style scoped>
/* ========== 基础变量 ========== */
.home-page {
  min-height: 100vh;
  background: var(--bg-body);
  overflow-x: hidden;
  position: relative;
}

.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* ========== 滚动进度条 ========== */
.scroll-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: var(--gradient-primary);
  z-index: 1001;
  transition: width 0.1s ease;
}

/* ========== 动态背景 ========== */
.animated-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.3;
  animation: float 20s ease-in-out infinite;
  will-change: transform;
}

.gradient-orb-1 {
  width: 600px;
  height: 600px;
  background: var(--gradient-primary);
  top: -200px;
  right: -100px;
  animation-delay: 0s;
}

.gradient-orb-2 {
  width: 500px;
  height: 500px;
  background: var(--gradient-achievement);
  bottom: -150px;
  left: -100px;
  animation-delay: -7s;
}

.gradient-orb-3 {
  width: 400px;
  height: 400px;
  background: var(--gradient-learning);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation-delay: -14s;
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -50px) scale(1.1);
  }
  66% {
    transform: translate(-20px, 30px) scale(0.9);
  }
}

/* 粒子效果 */
.particles {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

.particle {
  position: absolute;
  background: radial-gradient(circle, rgba(102, 126, 234, 0.4) 0%, transparent 70%);
  border-radius: 50%;
  animation: particle-float infinite ease-in-out;
}

[data-theme="dark"] .particle {
  background: radial-gradient(circle, rgba(74, 111, 165, 0.4) 0%, transparent 70%);
}

@keyframes particle-float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  90% {
    opacity: 0.6;
  }
  50% {
    transform: translate(20px, -30px) scale(1.2);
  }
}

/* 减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .gradient-orb,
  .particle {
    animation: none;
  }
}

/* ========== 导航栏 ========== */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  transition: all 0.3s ease;
}

[data-theme="dark"] .navbar {
  background: rgba(15, 24, 32, 0.9);
}

.navbar-scrolled {
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] .navbar-scrolled {
  background: rgba(15, 24, 32, 0.98);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.navbar-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
  padding-bottom: 1rem;
  position: relative;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 700;
  font-size: 1.25rem;
  color: var(--text-primary);
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  color: var(--text-primary);
  transition: opacity 0.2s ease;
}

.brand-link:hover {
  opacity: 0.8;
}

.brand-logo {
  font-size: 1.75rem;
}

.brand-logo-img {
  height: 36px;
  width: auto;
  object-fit: contain;
}

.navbar-nav {
  display: flex;
  gap: 2rem;
}

.nav-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: color 0.2s ease;
  position: relative;
}

.nav-link::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gradient-primary);
  transform: scaleX(0);
  transition: transform 0.3s ease;
}

.nav-link:hover {
  color: var(--color-primary);
}

.nav-link-active {
  color: var(--color-primary);
}

.nav-link-active::after,
.nav-link:hover::after {
  transform: scaleX(1);
}

.navbar-actions {
  display: flex;
  gap: 1rem;
}

.btn-primary {
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
  padding: 0.625rem 1.5rem;
  border-radius: var(--radius-lg);
  transition: all 0.3s;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
  transform: translateY(-2px);
}

[data-theme="dark"] .btn-primary {
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
}

[data-theme="dark"] .btn-primary:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  font-weight: 500;
  padding: 0.625rem 1.5rem;
  border-radius: var(--radius-lg);
  transition: all 0.3s;
}

.btn-secondary:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

/* 移动端汉堡菜单 */
.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  padding: 0.5rem;
  cursor: pointer;
  z-index: 1001;
}

.hamburger {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 24px;
}

.hamburger-line {
  width: 100%;
  height: 2px;
  background: var(--text-primary);
  transition: all 0.3s ease;
}

.hamburger-open .hamburger-line:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}

.hamburger-open .hamburger-line:nth-child(2) {
  opacity: 0;
}

.hamburger-open .hamburger-line:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* 移动端下拉菜单 */
.mobile-nav-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-body);
  border-top: 1px solid var(--border-default);
  padding: 1rem;
  display: none;
  flex-direction: column;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}

[data-theme="dark"] .mobile-nav-dropdown {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.dropdown-open {
  display: flex;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.mobile-nav-link {
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  text-decoration: none;
  font-weight: 500;
  font-size: 1rem;
  border-radius: var(--radius-lg);
  transition: background 0.2s ease, color var(--transition-normal);
}

.mobile-nav-link:hover {
  background: var(--bg-muted);
}

.mobile-nav-link-active {
  color: var(--color-primary);
  background: rgba(102, 126, 234, 0.08);
}

[data-theme="dark"] .mobile-nav-link-active {
  background: rgba(74, 111, 165, 0.08);
}

.mobile-nav-actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-light);
  margin-top: 0.5rem;
}

.mobile-nav-actions .btn {
  flex: 1;
  justify-content: center;
  padding: 0.625rem 1rem;
  font-size: 0.9rem;
}

.mobile-nav-actions .btn-primary {
  box-shadow: 0 3px 12px rgba(102, 126, 234, 0.25);
}

[data-theme="dark"] .mobile-nav-actions .btn-primary {
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
}

/* ========== 按钮系统 ========== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  font-weight: 600;
  font-size: 0.95rem;
  border-radius: var(--radius-full);
  text-decoration: none;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-outline {
  background: transparent;
  border: 2px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-outline:hover {
  background: var(--color-primary);
  color: white;
}

.btn-lg {
  padding: 1rem 2.5rem;
  font-size: 1.05rem;
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
  font-size: 1.25rem;
}

/* ========== Hero 区域 ========== */
.hero {
  position: relative;
  z-index: 1;
  padding: 14rem 0 8rem;
  min-height: 100vh;
  display: flex;
  align-items: center;
}

.hero-container {
  text-align: center;
}

.hero-content {
  max-width: 900px;
  margin: 0 auto;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

.badge-dot {
  width: 8px;
  height: 8px;
  background: var(--color-success);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.hero-title {
  font-size: clamp(2.6rem, 6.8vw, 5rem);
  font-weight: 800;
  line-height: 1.15;
  color: var(--text-primary);
  margin-bottom: 2rem;
  letter-spacing: -0.03em;
}

.hero-title-line {
  display: block;
}

.hero-title .highlight {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  color: var(--text-secondary);
  margin-bottom: 3rem;
  line-height: 1.8;
}

.hero-subtitle strong {
  color: var(--color-primary);
  font-weight: 700;
}

.hero-cta {
  margin-bottom: 4rem;
}

.cta-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 2rem;
}

.hero-proof {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin: 0 auto 2rem;
  max-width: 980px;
}

.proof-item {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 1rem 1.1rem;
  text-align: left;
}

.proof-item strong {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 700;
}

.proof-item span {
  display: block;
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.5;
}

/* 滚动提示 */
.scroll-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.scroll-arrow {
  font-size: 1.5rem;
  animation: bounce 2s ease-in-out infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

/* 统计数据 - 已移除 */

/* ========== Section 通用 ========== */
section {
  position: relative;
  z-index: 1;
}

/* ========== Footer ========== */
.footer-section {
  padding: 8rem 0 4rem;
  background: linear-gradient(180deg, transparent 0%, rgba(102, 126, 234, 0.08) 100%);
  transition: background var(--transition-normal);
}

[data-theme="dark"] .footer-section {
  background: linear-gradient(180deg, transparent 0%, rgba(74, 111, 165, 0.08) 100%);
}

.footer-content {
  text-align: center;
}

.footer-quote {
  margin-bottom: 3rem;
}

.quote-main {
  font-size: 1.5rem;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.8;
  margin-bottom: 1rem;
}

.quote-sub {
  font-size: 1.1rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.footer-cta {
  margin-bottom: 3rem;
}

.footer-links {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.footer-links a {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  transition: color 0.2s ease;
}

.footer-links a:hover {
  color: var(--color-primary);
}

.footer-bottom {
  padding-top: 2rem;
  border-top: 1px solid var(--border-light);
}

.footer-bottom p {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin: 0;
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
  .navbar-nav,
  .navbar-actions {
    display: none;
  }

  .mobile-menu-btn {
    display: block;
  }

  .hero {
    padding: 10rem 0 6rem;
  }

  .hero-title {
    font-size: clamp(2rem, 10vw, 4rem);
  }

  .hero-subtitle {
    font-size: clamp(1rem, 3vw, 1.25rem);
  }

  .cta-buttons {
    flex-direction: column;
    align-items: center;
  }

  .hero-proof {
    grid-template-columns: 1fr;
    max-width: 560px;
  }

  .proof-item {
    text-align: center;
  }

  .footer-links {
    flex-direction: column;
    gap: 1rem;
  }
}
</style>
