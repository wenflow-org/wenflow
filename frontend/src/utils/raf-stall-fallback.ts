/**
 * rAF 停帧兜底（2026-10-10 走查新人点击链实锤）：
 *
 * 背景：浏览器遮挡/后台化、部分嵌入式面板失焦等场景下页面完全不出帧——
 * `requestAnimationFrame` 回调永远不会被调用（实测 IAB 失焦面板 500ms 0 帧，
 * 而 setTimeout 正常）。Vue `<Transition>` 的进出场类推进（nextFrame=double-rAF）
 * 与 whenTransitionEnds 排定都挂在 rAF 上：停帧时 `mode="out-in"` 的过渡永远
 * 不 done，新内容不挂载——表现为 URL 已变视图不换、路由/步骤切换全部卡死
 * （b25ff5d6/780dfd27 族只除掉了 transitionend 依赖，rAF 依赖是未治净的残余）。
 *
 * 本兜底：监测到「连续 stallMs 未出帧」时，把已挂起的 rAF 回调经 setTimeout 放行；
 * 帧恢复后自动退场（keepalive 每帧刷新时间戳，看门狗不再放行）。
 * 只改变回调的时序通道，不改变回调语义与参数（时间戳用 performance.now()）。
 */
export function installRafStallFallback(stallMs = 250): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return () => {};
  }

  const origRaf = window.requestAnimationFrame.bind(window);
  const origCancel = window.cancelAnimationFrame.bind(window);

  let lastFrameAt = Date.now();
  let keepaliveAlive = true;
  const keepalive = () => {
    if (!keepaliveAlive) return;
    lastFrameAt = Date.now();
    origRaf(keepalive);
  };
  origRaf(keepalive);

  let nextId = 1;
  const pending = new Map<number, { fire: () => void; timer: number }>();

  const wrappedRaf = ((callback: FrameRequestCallback): number => {
    const id = nextId++;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      const entry = pending.get(id);
      if (entry) window.clearTimeout(entry.timer);
      pending.delete(id);
      callback(performance.now());
    };
    const timer = window.setTimeout(() => {
      if (Date.now() - lastFrameAt >= stallMs) fire();
    }, stallMs);
    pending.set(id, { fire, timer });
    origRaf(fire);
    return id;
  }) as typeof window.requestAnimationFrame;

  const wrappedCancel = ((id: number) => {
    const entry = pending.get(id);
    if (entry) {
      window.clearTimeout(entry.timer);
      pending.delete(id);
    }
    origCancel(id);
  }) as typeof window.cancelAnimationFrame;

  window.requestAnimationFrame = wrappedRaf;
  window.cancelAnimationFrame = wrappedCancel;

  return () => {
    keepaliveAlive = false;
    window.requestAnimationFrame = origRaf as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = origCancel as typeof window.cancelAnimationFrame;
  };
}
