/**
 * vitest 全局环境准备（jsdom 缺失 API 补齐）
 * - matchMedia：element-plus / 部分组件挂载时读取
 * - ResizeObserver：el-table / el-select 等组件挂载时读取
 */

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }) as unknown as MediaQueryList;
}

if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

// vue-router scrollBehavior 会调用 window.scrollTo，jsdom 已定义但抛「Not implemented」→ 覆盖
if (typeof window !== 'undefined') {
  window.scrollTo = () => undefined;
}

/* ECharts（MkChart 组件）在 jsdom 下需要 canvas 2D context，否则 init 抛
   「Cannot set properties of null (setting 'dpr')」→ 覆盖 jsdom 的 getContext
   （jsdom 默认实现存在但抛 Not implemented，需无条件替换为 stub） */
if (typeof window !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
      return {
        canvas: this,
        /* 最小 2D context stub（ECharts 渲染所需的方法子集） */
        measureText: () => ({ width: 0 }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        createPattern: () => null,
        getImageData: () => ({ data: [] }),
        putImageData: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        scale: () => undefined,
        rotate: () => undefined,
        translate: () => undefined,
        transform: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        fillRect: () => undefined,
        strokeRect: () => undefined,
        beginPath: () => undefined,
        closePath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        bezierCurveTo: () => undefined,
        quadraticCurveTo: () => undefined,
        arc: () => undefined,
        arcTo: () => undefined,
        ellipse: () => undefined,
        rect: () => undefined,
        clip: () => undefined,
        fill: () => undefined,
        stroke: () => undefined,
        fillText: () => undefined,
        strokeText: () => undefined,
        drawImage: () => undefined,
        setLineDash: () => undefined,
        getLineDash: () => [],
        setLineCap: () => undefined,
        setLineJoin: () => undefined,
        setMiterLimit: () => undefined,
        set globalAlpha(_v: number) {},
        set globalCompositeOperation(_v: string) {},
        set fillStyle(_v: string | CanvasGradient | CanvasPattern) {},
        set strokeStyle(_v: string | CanvasGradient | CanvasPattern) {},
        set lineWidth(_v: number) {},
        set lineCap(_v: CanvasLineCap) {},
        set lineJoin(_v: CanvasLineJoin) {},
        set shadowBlur(_v: number) {},
        set shadowColor(_v: string) {},
        set shadowOffsetX(_v: number) {},
        set shadowOffsetY(_v: number) {},
        set font(_v: string) {},
        set textAlign(_v: CanvasTextAlign) {},
        set textBaseline(_v: CanvasTextBaseline) {},
      } as unknown as CanvasRenderingContext2D;
    }
    if (contextId === 'webgl' || contextId === 'experimental-webgl') {
      return null;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

/* ECharts 还会读 canvas.getBoundingClientRect 与 width/height 属性（jsdom 默认 0 即可，无需处理） */

