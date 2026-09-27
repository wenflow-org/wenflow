<template>
  <figure class="teaching-diagram">
    <button
      type="button"
      ref="hostRef"
      class="teaching-diagram__canvas"
      :class="{ 'teaching-diagram__canvas--zoomable': !failed }"
      :aria-label="failed ? '结构图代码' : '放大查看结构图'"
      :disabled="failed"
      @click="openZoom"
    ></button>
    <pre v-if="failed" class="teaching-diagram__fallback">{{ code }}</pre>
    <span v-else class="teaching-diagram__hint" aria-hidden="true">点击放大</span>
    <figcaption v-if="caption">{{ caption }}</figcaption>
    <!-- 放大层：宽图在窄卡里按原尺寸横向滚动仍嫌小，点开满屏可读 -->
    <Teleport to="body">
      <div v-if="zoomed" class="diagram-zoom" role="dialog" aria-modal="true" aria-label="结构图放大" @click="closeZoom">
        <div ref="zoomRef" class="diagram-zoom__canvas" :class="{ 'diagram-zoom__canvas--fit': zoomFit }" @click.stop></div>
        <div class="diagram-zoom__bar" @click.stop>
          <button type="button" class="diagram-zoom__btn" :aria-pressed="zoomFit" @click="zoomFit = !zoomFit">
            {{ zoomFit ? '原尺寸' : '适应屏幕' }}
          </button>
          <button type="button" class="diagram-zoom__btn" @click="closeZoom">关闭</button>
        </div>
      </div>
    </Teleport>
  </figure>
</template>

<script setup lang="ts">
/**
 * 课堂结构图（2026-09-27 双通道重构）——老师给的 mermaid 源码，前端确定性渲染。
 *
 * 与旧生图（TeachingImage）的本质区别：不是生成物而是**代码**——毫秒级、零乱码、
 * 图内中文标签就是教学信息本身。渲染失败（坏语法）时降级为代码块（课堂不阻断）。
 *
 * 渲染安全：securityLevel:'strict' + mermaid.run 内部消毒；后端出口已过滤 %%{init/click/href。
 * 加载策略：mermaid 体积大，动态 import 单例懒加载；模块级串行队列防并发 run（对齐 MarkdownRenderer 先例）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  code: string;
  caption?: string | null;
}>();

const hostRef = ref<HTMLElement | null>(null);
const zoomRef = ref<HTMLElement | null>(null);
const failed = ref(false);
const zoomed = ref(false);
/** 放大层视图：适应屏幕（看整体形状，默认）/ 原尺寸（看标签细节，可滚动） */
const zoomFit = ref(true);

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((mod) => {
        const mermaid = mod.default;
        // 结构图通常浅底深线：neutral 主题在白卡上最清晰；课堂容器给浅色底（见样式）
        // useMaxWidth:false —— 图按自然尺寸出，窄卡里横向滚动（默认 true 会把宽图整幅缩到看不清）
        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'strict',
          flowchart: { useMaxWidth: false },
          sequence: { useMaxWidth: false },
          class: { useMaxWidth: false },
          state: { useMaxWidth: false },
          er: { useMaxWidth: false },
        });
        return mermaid;
      })
      .catch((error) => {
        // 加载失败重置 promise 允许下次重试（弱网首屏失败不永久报废）
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

// 串行化渲染：消息批量恢复/快速切换时避免并发 run 操作同批节点
let renderQueue: Promise<void> = Promise.resolve();

/**
 * 用真实内容 bbox 重设画布尺寸。
 * 背景：mermaid 在本站页面里算出的 viewBox/width/height 会被页面级 CSS 放大（实测内容 bbox
 * 817×542，它却给 2115×2055 的画布），整幅图因此被缩到标签看不清——与"图要能自己教"的验收相悖。
 * 渲染后按 bbox 重设 viewBox 与宽高，图即按 1:1 自然尺寸出（宽图由卡片横向滚动承接）。
 */
function fitSvgToContent(svg: SVGSVGElement, padding = 8) {
  let box: DOMRect;
  try {
    box = svg.getBBox();
  } catch {
    return;
  }
  if (!box.width || !box.height) return;
  const w = Math.ceil(box.width + padding * 2);
  const h = Math.ceil(box.height + padding * 2);
  svg.setAttribute('viewBox', `${box.x - padding} ${box.y - padding} ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.removeAttribute('style');
}

async function renderDiagram() {
  const host = hostRef.value;
  if (!host || !props.code.trim()) return;
  renderQueue = renderQueue.then(async () => {
    const el = hostRef.value;
    if (!el) return;
    // 每次全量重画：清空后放一个 .mermaid 节点交给 mermaid.run（它负责生成 SVG 并替换内容）
    el.textContent = '';
    const node = document.createElement('div');
    node.className = 'mermaid';
    node.textContent = props.code;
    el.appendChild(node);
    try {
      const mermaid = await loadMermaid();
      await mermaid.run({ nodes: [node] });
      const svg = node.querySelector('svg');
      if (svg) fitSvgToContent(svg as SVGSVGElement);
      failed.value = false;
    } catch {
      // 坏语法/加载失败：降级为代码块（老师看到原文，学生不阻断）
      failed.value = true;
      el.textContent = '';
    }
  });
  return renderQueue;
}

onMounted(renderDiagram);
watch(() => props.code, (next) => {
  closeZoom();
  if (!next) return;
  renderDiagram();
});

/** 放大层：克隆已渲染的 SVG 到满屏层（不移动原节点，关闭后原图原样还在） */
function openZoom() {
  if (failed.value) return;
  const svg = hostRef.value?.querySelector('svg');
  if (!svg) return;
  zoomed.value = true;
  requestAnimationFrame(() => {
    const host = zoomRef.value;
    if (!host) return;
    host.textContent = '';
    host.appendChild(svg.cloneNode(true));
  });
}

function closeZoom() {
  zoomed.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && zoomed.value) closeZoom();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.teaching-diagram {
  position: relative;
  margin: 10px 0 0;
  padding: 12px 12px 8px;
  /* 结构图给浅色画布：mermaid neutral 主题在白底上最清晰（课堂暗色主题下的"教具纸"效果） */
  background: #ffffff;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  overflow-x: auto;
}
.teaching-diagram__canvas {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: default;
}
.teaching-diagram__canvas--zoomable {
  cursor: zoom-in;
}
.teaching-diagram__canvas:disabled {
  cursor: default;
}
/* 自然尺寸出图：宽图在卡内横向滚动，不整幅缩到看不清（见 loadMermaid 的 useMaxWidth 注释） */
.teaching-diagram__canvas :deep(svg) {
  display: block;
  max-width: none;
  height: auto;
}
.teaching-diagram__fallback {
  margin: 0;
  padding: 8px 10px;
  background: var(--mk-surface-2, #f6f8fa);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.teaching-diagram figcaption {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  text-align: center;
}
.teaching-diagram__hint {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #6b7280;
  font-size: 11px;
  pointer-events: none;
}
/* 放大层（Teleport 到 body，不受 scoped 限制但保留前缀便于识别） */
.diagram-zoom {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.72);
  cursor: zoom-out;
}
.diagram-zoom__canvas {
  max-width: 96vw;
  max-height: 88vh;
  padding: 16px;
  overflow: auto;
  background: #ffffff;
  border-radius: 12px;
  cursor: default;
}
.diagram-zoom__canvas :deep(svg) {
  display: block;
  max-width: none;
  height: auto;
}
/* 适应屏幕：整幅缩进视口（看结构形状）；原尺寸：16px 标签照排，可平移细看 */
.diagram-zoom__canvas--fit :deep(svg) {
  max-width: 100%;
  max-height: 80vh;
  width: auto;
  height: auto;
}
.diagram-zoom__bar {
  position: absolute;
  top: 16px;
  right: 20px;
  display: flex;
  gap: 8px;
}
.diagram-zoom__btn {
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
</style>
