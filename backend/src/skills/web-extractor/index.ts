/**
 * Web Extractor Skill
 *
 * 从网页中提取结构化学习内容
 * 借鉴 Qwen3.5-9B-ToolHub 的 web_extractor 工具
 */

import axios from 'axios';
import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';

// 输入类型定义
export interface WebExtractorInput {
  url: string;
  extractType?: 'full' | 'article' | 'code' | 'outline';
  maxLength?: number;
  includeImages?: boolean;
  includeLinks?: boolean;
  timeout?: number;
}

// 输出类型定义
export interface WebExtractorOutput {
  title: string;
  url: string;
  content: string;
  summary?: string;
  structure: {
    headings: Array<{
      level: number;
      text: string;
    }>;
    paragraphs: string[];
    codeBlocks?: Array<{
      language?: string;
      code: string;
    }>;
    tables?: Array<{
      headers: string[];
      rows: string[][];
    }>;
  };
  links?: Array<{
    text: string;
    url: string;
  }>;
  images?: Array<{
    alt?: string;
    src: string;
  }>;
  metadata: {
    author?: string;
    publishDate?: string;
    wordCount: number;
    readTime: number; // 分钟
  };
}

/**
 * Web Extractor Skill 定义
 */
export const webExtractorDefinition: SkillDefinition = {
  name: 'web-extractor',
  version: '1.0.0',
  category: 'parsing',
  description: '从网页URL提取结构化学习内容，包括标题、大纲、代码块、表格等',

  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要提取的网页URL',
        required: true
      },
      extractType: {
        type: 'string',
        description: '提取类型: full(完整)|article(文章)|code(代码)|outline(大纲)',
        required: false,
        default: 'article'
      },
      maxLength: {
        type: 'number',
        description: '最大内容长度',
        required: false,
        default: 10000
      },
      includeImages: {
        type: 'boolean',
        description: '是否包含图片信息',
        required: false,
        default: false
      },
      includeLinks: {
        type: 'boolean',
        description: '是否包含链接信息',
        required: false,
        default: true
      },
      timeout: {
        type: 'number',
        description: '请求超时时间(毫秒)',
        required: false,
        default: 30000
      }
    }
  },

  outputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '页面标题'
      },
      url: {
        type: 'string',
        description: '页面URL'
      },
      content: {
        type: 'string',
        description: '提取的文本内容'
      },
      summary: {
        type: 'string',
        description: '内容摘要'
      },
      structure: {
        type: 'object',
        description: '内容结构'
      },
      metadata: {
        type: 'object',
        description: '元数据信息'
      }
    }
  },

  capabilities: [
    'web-scraping',
    'content-extraction',
    'html-parsing',
    'structure-analysis',
    'code-extraction',
    'outline-generation'
  ],

  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Web Extractor Skill 实现
 */
export async function webExtractor(
  input: WebExtractorInput
): Promise<SkillExecutionResult<WebExtractorOutput>> {
  const startTime = Date.now();

  try {
    const {
      url,
      extractType = 'article',
      maxLength = 10000,
      includeImages = false,
      includeLinks = true,
      timeout = 30000
    } = input;

    // 验证 URL
    if (!isValidUrl(url)) {
      return {
        success: false,
        error: {
          code: 'INVALID_URL',
          message: 'Invalid URL format'
        },
        duration: Date.now() - startTime
      };
    }

    // 获取网页内容
    const html = await fetchWebPage(url, timeout);

    // 解析 HTML
    const extractedData = parseHtml(html, url, {
      extractType,
      maxLength,
      includeImages,
      includeLinks
    });

    return {
      success: true,
      output: extractedData,
      duration: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      error: {
        code: 'EXTRACTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error during extraction'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 验证 URL 格式
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取网页内容
 */
async function fetchWebPage(url: string, timeout: number): Promise<string> {
  try {
    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      maxContentLength: 10 * 1024 * 1024, // 10MB
      responseType: 'text'
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    if (error.response) {
      throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
    }
    throw new Error(`Failed to fetch page: ${error.message}`);
  }
}

/**
 * 解析 HTML
 */
function parseHtml(
  html: string,
  url: string,
  options: {
    extractType: string;
    maxLength: number;
    includeImages: boolean;
    includeLinks: boolean;
  }
): WebExtractorOutput {
  const { extractType, maxLength, includeImages, includeLinks } = options;

  // 提取标题
  const title = extractTitle(html);

  // 移除不需要的标签
  const cleanHtml = removeUnwantedTags(html);

  // 提取结构
  const headings = extractHeadings(cleanHtml);
  const codeBlocks = extractType === 'code' || extractType === 'full' ? extractCodeBlocks(cleanHtml) : [];
  const tables = extractType === 'full' ? extractTables(cleanHtml) : [];

  // 提取正文
  let content = extractContent(cleanHtml, extractType);

  // 截断内容
  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + '...';
  }

  // 生成摘要
  const summary = generateSummary(content);

  // 提取链接
  const links = includeLinks ? extractLinks(cleanHtml, url) : [];

  // 提取图片
  const images = includeImages ? extractImages(cleanHtml, url) : [];

  // 提取元数据
  const metadata = extractMetadata(html, content);

  return {
    title,
    url,
    content,
    summary,
    structure: {
      headings,
      paragraphs: content.split('\n\n').filter(p => p.trim()),
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      tables: tables.length > 0 ? tables : undefined
    },
    links: links.length > 0 ? links : undefined,
    images: images.length > 0 ? images : undefined,
    metadata
  };
}

/**
 * 提取标题
 */
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }

  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match) {
    return stripHtmlTags(h1Match[1]).trim();
  }

  return 'Untitled';
}

/**
 * 移除不需要的标签
 */
function removeUnwantedTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 提取标题层级
 */
function extractHeadings(html: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const regex = /<h([1-6])[^>]*>([^<]*)<\/h\1>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      text: decodeHtmlEntities(stripHtmlTags(match[2]).trim())
    });
  }

  return headings;
}

/**
 * 提取代码块
 */
function extractCodeBlocks(html: string): Array<{ language?: string; code: string }> {
  const codeBlocks: Array<{ language?: string; code: string }> = [];

  // 匹配 pre > code 结构
  const preCodeRegex = /<pre[^>]*>[\s\S]*?<code[^>]*(?:class=["']([^"']*)["'])?[\s\S]*?>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi;
  let match;

  while ((match = preCodeRegex.exec(html)) !== null) {
    const className = match[1] || '';
    const language = extractLanguageFromClass(className);
    const code = decodeHtmlEntities(stripHtmlTags(match[2]).trim());

    if (code.length > 10) {
      codeBlocks.push({ language, code });
    }
  }

  return codeBlocks;
}

/**
 * 从 class 名提取语言
 */
function extractLanguageFromClass(className: string): string | undefined {
  const langMatch = className.match(/(?:language-|lang-)(\w+)/i);
  if (langMatch) {
    return langMatch[1].toLowerCase();
  }

  const commonLangs = ['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'go', 'rust', 'html', 'css', 'sql', 'bash', 'json', 'xml', 'yaml'];
  for (const lang of commonLangs) {
    if (className.toLowerCase().includes(lang)) {
      return lang;
    }
  }

  return undefined;
}

/**
 * 提取表格
 */
function extractTables(html: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[1];

    // 提取表头
    const headers: string[] = [];
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    while ((thMatch = thRegex.exec(tableHtml)) !== null) {
      headers.push(decodeHtmlEntities(stripHtmlTags(thMatch[1]).trim()));
    }

    // 提取行
    const rows: string[][] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      const rowHtml = trMatch[1];
      const cells: string[] = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        cells.push(decodeHtmlEntities(stripHtmlTags(tdMatch[1]).trim()));
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (headers.length > 0 || rows.length > 0) {
      tables.push({ headers, rows });
    }
  }

  return tables;
}

/**
 * 提取正文内容
 */
function extractContent(html: string, extractType: string): string {
  // 根据提取类型选择内容区域
  let contentHtml = html;

  if (extractType === 'article') {
    // 尝试找到文章主体
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      contentHtml = articleMatch[1];
    } else {
      // 尝试找 main 或 content 区域
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                       html.match(/<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                       html.match(/<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i);
      if (mainMatch) {
        contentHtml = mainMatch[1];
      }
    }
  }

  // 转换为纯文本
  let text = stripHtmlTags(contentHtml);

  // 清理多余空白
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return text;
}

/**
 * 提取链接
 */
function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = decodeHtmlEntities(stripHtmlTags(match[2]).trim());

    // 跳过锚点链接和 javascript
    if (href.startsWith('#') || href.startsWith('javascript:')) {
      continue;
    }

    // 转换为绝对 URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    // 只保留 http/https 链接
    if (absoluteUrl.startsWith('http')) {
      links.push({ text: text || absoluteUrl, url: absoluteUrl });
    }
  }

  // 去重
  const seen = new Set<string>();
  return links.filter(link => {
    if (seen.has(link.url)) {
      return false;
    }
    seen.add(link.url);
    return true;
  });
}

/**
 * 提取图片
 */
function extractImages(html: string, baseUrl: string): Array<{ alt?: string; src: string }> {
  const images: Array<{ alt?: string; src: string }> = [];
  const regex = /<img[^>]*src=["']([^"']*)["'][^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    const altMatch = match[0].match(/alt=["']([^"]*)["']/i);
    const alt = altMatch ? altMatch[1] : undefined;

    // 转换为绝对 URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(src, baseUrl).href;
    } catch {
      continue;
    }

    if (absoluteUrl.startsWith('http')) {
      images.push({ alt, src: absoluteUrl });
    }
  }

  return images;
}

/**
 * 提取元数据
 */
function extractMetadata(html: string, content: string): WebExtractorOutput['metadata'] {
  const metadata: WebExtractorOutput['metadata'] = {
    wordCount: content.split(/\s+/).length,
    readTime: Math.ceil(content.split(/\s+/).length / 200) // 假设每分钟200字
  };

  // 提取作者
  const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"]*)["']/i) ||
                     html.match(/<meta[^>]*content=["']([^"]*)["'][^>]*name=["']author["']/i);
  if (authorMatch) {
    metadata.author = authorMatch[1];
  }

  // 提取发布日期
  const dateMatch = html.match(/<meta[^>]*name=["'](?:published_time|article:published_time|datePublished)["'][^>]*content=["']([^"]*)["']/i) ||
                   html.match(/<meta[^>]*content=["']([^"]*)["'][^>]*name=["'](?:published_time|article:published_time|datePublished)["']/i);
  if (dateMatch) {
    metadata.publishDate = dateMatch[1];
  }

  return metadata;
}

/**
 * 生成摘要
 */
function generateSummary(content: string): string {
  // 取前200字作为摘要
  const maxSummaryLength = 200;
  if (content.length <= maxSummaryLength) {
    return content;
  }

  // 在句子边界截断
  const truncated = content.substring(0, maxSummaryLength);
  const lastPeriod = truncated.lastIndexOf('。');
  const lastNewline = truncated.lastIndexOf('\n\n');

  const cutPoint = Math.max(lastPeriod > 0 ? lastPeriod + 1 : 0, lastNewline > 0 ? lastNewline : 0);

  if (cutPoint > maxSummaryLength * 0.5) {
    return truncated.substring(0, cutPoint).trim() + '...';
  }

  return truncated.trim() + '...';
}

/**
 * 移除 HTML 标签
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…'
  };

  return text.replace(/&[^;]+;/g, entity => entities[entity] || entity);
}

export default webExtractor;
