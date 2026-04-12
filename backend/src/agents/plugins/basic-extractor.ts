/**
 * Basic Extractor Plugin
 *
 * 内容提取插件 - 从网页、文档等提取学习内容
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../plugin-types';
import { getOpenAIClient } from '../../gateway/openai-client';
import axios from 'axios';

/**
 * 基础内容提取插件
 */
export const basicExtractor: AgentPlugin = {
  id: 'basic-extractor',
  name: '内容提取器',
  version: '1.0.0',
  description: '从网页、文档、URL等来源提取和解析学习内容',
  type: 'requirement-extractor',
  capabilities: [
    'web-scraping',
    'content-parsing',
    'structure-extraction',
    'knowledge-extraction',
    'url-analysis'
  ],

  config: {
    temperature: 0.3,
    maxTokens: 8000,  // 从大量网页内容提取结构化数据需要更多token空间
    systemPrompt: `你是内容提取和分析专家。

【任务】
从提供的网页内容或文本中提取关键学习内容，并进行结构化整理。

【输入】
- URL 内容
- 或原始文本
- 或用户指定的提取需求

【输出格式 - 必须严格遵循】
{
  "title": "内容标题",
  "summary": "内容摘要（100-200字）",
  "keyPoints": [
    "关键要点1",
    "关键要点2",
    "关键要点3"
  ],
  "structure": {
    "sections": [
      {
        "heading": "章节标题",
        "content": "章节内容概要"
      }
    ]
  },
  "relevantLinks": [
    {
      "url": "链接地址",
      "title": "链接标题",
      "description": "链接描述"
    }
  ],
  "difficulty": "beginner|intermediate|advanced",
  "estimatedReadTime": 10,
  "tags": ["标签1", "标签2"]
}

【提取原则】
1. 保留核心知识点
2. 识别内容结构（章节、层级）
3. 提取相关的外部资源链接
4. 评估内容难度等级
5. 提取合适的标签

【注意事项】
- 如果输入不是有效的URL或内容，返回适当的错误信息
- 对于无法访问的内容，说明原因
- estimatedReadTime 以分钟为单位`,
    model: 'deepseek-chat',
    timeout: 60000,
    retries: 2,
    maxContentLength: 50000
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const client = getOpenAIClient();
    const startTime = Date.now();

    try {
      let content = '';

      // 根据输入类型处理
      if (input.url) {
        // 从URL提取内容
        content = await this.fetchUrlContent(input.url);
      } else if (input.text) {
        // 直接处理文本内容
        content = input.text;
      } else if (input.html) {
        // 处理HTML内容
        content = this.parseHtml(input.html);
      } else {
        throw new Error('Invalid input: need url, text, or html');
      }

      // 如果内容太长，截取前面部分
      if (content.length > (this.config!.maxContentLength || 50000)) {
        content = content.substring(0, this.config!.maxContentLength || 50000);
      }

      // 使用 AI 分析和结构化内容
      const analysisPrompt = this.buildAnalysisPrompt(input, content);

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: this.config!.systemPrompt!
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ];

      const response = await client.chatCompletion({
        messages,
        temperature: this.config!.temperature,
        max_tokens: this.config!.maxTokens,
        model: this.config!.model
      });

      const responseContent = response.choices[0]?.message.content || '{}';

      // 解析 JSON
      let data: any;
      try {
        data = JSON.parse(responseContent);
      } catch {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          // 如果不是 JSON，作为原始内容返回
          data = {
            rawContent: content,
            summary: responseContent.substring(0, 200),
            keyPoints: []
          };
        }
      }

      // 添加原始内容信息
      data._extractedFrom = input.url ? { type: 'url', value: input.url } : { type: 'text', length: content.length };

      // 构建用户可见的摘要文本
      const keyPointsCount = data.keyPoints?.length || 0;
      const userVisible = `内容提取完成！共提取到 ${keyPointsCount} 个关键点。${data.summary || ''}`.substring(0, 200);

      return {
        success: true,
        userVisible,
        internal: data,  // 新格式：结构化数据放在 internal
        data,  // 保留旧格式向后兼容
        metadata: {
          agentId: this.id,
          agentName: this.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          tokensUsed: response.usage?.total_tokens
        }
      };
    } catch (error: any) {
      return {
        success: false,
        userVisible: '内容提取失败，请检查输入或稍后重试。',
        error: error.message || 'Failed to extract content',
        metadata: {
          agentId: this.id,
          agentName: this.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    }
  },

  /**
   * 获取URL内容
   */
  async fetchUrlContent(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxContentLength: 50000
      });

      // 简单解析 HTML 为纯文本
      return this.parseHtml(response.data);
    } catch (error: any) {
      throw new Error(`Failed to fetch URL: ${error.message}`);
    }
  },

  /**
   * 解析 HTML 为纯文本
   */
  parseHtml(html: string): string {
    // 移除脚本和样式
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    
    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, '\n');
    
    // 移除多余空白
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');
    
    // 解码 HTML 实体
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    
    return text.trim();
  },

  /**
   * 构建分析提示
   */
  buildAnalysisPrompt(input: any, content: string): string {
    const parts = [
      '请分析以下内容并提取关键信息：',
      '\n--- 内容 ---\n',
      content
    ];

    if (input.extractFocus) {
      parts.push('\n--- 提取重点 ---\n');
      parts.push(input.extractFocus);
    }

    if (input.topic) {
      parts.push('\n--- 主题领域 ---\n');
      parts.push(input.topic);
    }

    return parts.join('');
  }
};

export default basicExtractor;
