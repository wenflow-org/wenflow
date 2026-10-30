import type { MermaidConfig } from 'mermaid';

/**
 * 课堂/聊天里的 Mermaid 统一配置。
 *
 * 深色模式必须同时换主题和画布底色：只把外层卡片改深、图仍是 neutral 浅色时，
 * 节点深字/浅底会在暗底上形成刺眼白块。naturalSize 仅用于 TeachingDiagram——
 * 课堂结构图按自然尺寸出图、宽图横向滚动；聊天内联图仍用 useMaxWidth 自适应气泡宽度。
 */
export function buildMermaidConfig(options: {
  dark: boolean;
  /** 浅色时使用的 Mermaid 内置主题：结构图用 neutral，聊天用 default */
  lightTheme: 'neutral' | 'default';
  /** true = 关闭 useMaxWidth，宽图由容器横向滚动（TeachingDiagram） */
  naturalSize?: boolean;
}): MermaidConfig {
  const { dark, lightTheme, naturalSize = false } = options;
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : lightTheme,
    themeVariables: dark
      ? {
          darkMode: true,
          background: 'transparent',
          fontFamily: 'PingFang SC, Microsoft YaHei, system-ui, sans-serif',
        }
      : undefined,
  };
  if (naturalSize) {
    config.flowchart = { useMaxWidth: false };
    config.sequence = { useMaxWidth: false };
    config.class = { useMaxWidth: false };
    config.state = { useMaxWidth: false };
    config.er = { useMaxWidth: false };
  }
  return config;
}

/**
 * Mermaid 是模块级单例，`initialize` 会改写全局配置；课堂里 TeachingDiagram（自然尺寸）
 * 与 Markdown 气泡（自适应宽度）可能交替渲染。各自只记「上次主题」会漏掉尺寸差异，
 * 导致后一次渲染沿用前一处的 useMaxWidth。这里用完整配置签名做单一事实源。
 */
let lastConfigKey = '';
export function ensureMermaidConfig(
  mermaid: { initialize: (config: MermaidConfig) => void },
  options: { dark: boolean; lightTheme: 'neutral' | 'default'; naturalSize?: boolean }
): void {
  const key = `${options.dark ? 'dark' : 'light'}|${options.lightTheme}|${options.naturalSize ? 'natural' : 'auto'}`;
  if (key === lastConfigKey) return;
  mermaid.initialize(buildMermaidConfig(options));
  lastConfigKey = key;
}
