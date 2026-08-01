/**
 * markdown-it / markdown-it-katex 未随包提供类型声明（项目未安装 @types/markdown-it），
 * 这里按项目内的实际用法补充最小类型声明。
 */
declare module 'markdown-it' {
  interface MarkdownItOptions {
    html?: boolean;
    breaks?: boolean;
    linkify?: boolean;
    highlight?: ((str: string, lang: string) => string) | null;
  }

  interface MarkdownItUtils {
    escapeHtml(str: string): string;
  }

  export default class MarkdownIt {
    constructor(options?: MarkdownItOptions);
    utils: MarkdownItUtils;
    use(plugin: unknown, ...params: unknown[]): this;
    render(src: string): string;
  }
}

declare module 'markdown-it-katex' {
  const markdownItKatex: unknown;
  export default markdownItKatex;
}
