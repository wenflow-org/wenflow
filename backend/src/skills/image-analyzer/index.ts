/**
 * Image Analyzer Skill
 *
 * 分析图片内容，支持代码截图、报错截图、架构图等
 * 借鉴 Qwen3.5-9B-ToolHub 的 image_zoom_in_tool
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';

// 输入类型定义
export interface ImageAnalyzerInput {
  imageUrl?: string;
  imageBase64?: string;
  imageBuffer?: Buffer;
  analysisType: 'ocr' | 'code' | 'error' | 'diagram' | 'general';
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoomLevel?: number; // 1-5，放大级别
  language?: string; // OCR 语言
}

// 输出类型定义
export interface ImageAnalyzerOutput {
  text?: string; // OCR 识别的文本
  code?: {
    language: string;
    code: string;
    explanation?: string;
  };
  error?: {
    errorType: string;
    errorMessage: string;
    suggestedFix?: string;
  };
  diagram?: {
    type: string;
    components: Array<{
      name: string;
      type: string;
      description?: string;
    }>;
    relationships: Array<{
      from: string;
      to: string;
      type: string;
    }>;
  };
  general?: {
    description: string;
    objects: string[];
    textContent: string;
  };
  metadata: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
}

/**
 * Image Analyzer Skill 定义
 */
export const imageAnalyzerDefinition: SkillDefinition = {
  name: 'image-analyzer',
  version: '1.0.0',
  category: 'analysis',
  description: '分析图片内容，支持代码截图识别、报错分析、架构图解析、OCR文字提取等',

  inputSchema: {
    type: 'object',
    properties: {
      imageUrl: {
        type: 'string',
        description: '图片URL地址',
        required: false
      },
      imageBase64: {
        type: 'string',
        description: 'Base64编码的图片数据',
        required: false
      },
      imageBuffer: {
        type: 'buffer',
        description: '图片Buffer数据',
        required: false
      },
      analysisType: {
        type: 'string',
        description: '分析类型: ocr|code|error|diagram|general',
        required: true
      },
      region: {
        type: 'object',
        description: '指定分析区域 {x, y, width, height}',
        required: false
      },
      zoomLevel: {
        type: 'number',
        description: '放大级别 1-5',
        required: false,
        default: 1
      },
      language: {
        type: 'string',
        description: 'OCR语言',
        required: false,
        default: 'auto'
      }
    }
  },

  outputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'OCR识别的文本'
      },
      code: {
        type: 'object',
        description: '代码分析结果'
      },
      error: {
        type: 'object',
        description: '错误分析结果'
      },
      diagram: {
        type: 'object',
        description: '架构图分析结果'
      },
      general: {
        type: 'object',
        description: '通用分析结果'
      },
      metadata: {
        type: 'object',
        description: '图片元数据'
      }
    }
  },

  capabilities: [
    'ocr',
    'code-recognition',
    'error-analysis',
    'diagram-parsing',
    'image-understanding',
    'region-zoom'
  ],

  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Image Analyzer Skill 实现
 */
export async function imageAnalyzer(
  input: ImageAnalyzerInput
): Promise<SkillExecutionResult<ImageAnalyzerOutput>> {
  const startTime = Date.now();

  try {
    const {
      imageUrl,
      imageBase64,
      imageBuffer,
      analysisType,
      region,
      zoomLevel = 1,
      language = 'auto'
    } = input;

    // 验证输入
    if (!imageUrl && !imageBase64 && !imageBuffer) {
      return {
        success: false,
        error: {
          code: 'MISSING_IMAGE',
          message: '必须提供 imageUrl、imageBase64 或 imageBuffer 之一'
        },
        duration: Date.now() - startTime
      };
    }

    // 获取图片数据
    let imageData: Buffer;
    let metadata: ImageAnalyzerOutput['metadata'];

    if (imageBuffer) {
      imageData = imageBuffer;
      metadata = await getImageMetadata(imageBuffer);
    } else if (imageBase64) {
      imageData = Buffer.from(imageBase64, 'base64');
      metadata = await getImageMetadata(imageData);
    } else if (imageUrl) {
      const fetched = await fetchImage(imageUrl);
      imageData = fetched.data;
      metadata = fetched.metadata;
    } else {
      throw new Error('无法获取图片数据');
    }

    // 如果指定了区域，裁剪图片
    if (region) {
      imageData = await cropImage(imageData, region, zoomLevel);
    }

    // 根据分析类型执行不同分析
    let result: Partial<ImageAnalyzerOutput> = { metadata };

    switch (analysisType) {
      case 'ocr':
        result = { ...result, ...await performOCR(imageData, language) };
        break;
      case 'code':
        result = { ...result, ...await analyzeCode(imageData) };
        break;
      case 'error':
        result = { ...result, ...await analyzeError(imageData) };
        break;
      case 'diagram':
        result = { ...result, ...await analyzeDiagram(imageData) };
        break;
      case 'general':
        result = { ...result, ...await analyzeGeneral(imageData) };
        break;
      default:
        return {
          success: false,
          error: {
            code: 'INVALID_ANALYSIS_TYPE',
            message: `不支持的分析类型: ${analysisType}`
          },
          duration: Date.now() - startTime
        };
    }

    return {
      success: true,
      output: result as ImageAnalyzerOutput,
      duration: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      error: {
        code: 'ANALYSIS_ERROR',
        message: error instanceof Error ? error.message : '图片分析失败'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 获取图片元数据
 */
async function getImageMetadata(buffer: Buffer): Promise<ImageAnalyzerOutput['metadata']> {
  // 简化的元数据提取
  const size = buffer.length;

  // 检测图片格式
  let format = 'unknown';
  if (buffer.slice(0, 8).toString('hex').startsWith('89504e47')) {
    format = 'png';
  } else if (buffer.slice(0, 3).toString('hex') === 'ffd8ff') {
    format = 'jpeg';
  } else if (buffer.slice(0, 4).toString() === 'RIFF') {
    format = 'webp';
  } else if (buffer.slice(0, 3).toString() === 'GIF') {
    format = 'gif';
  }

  // 尝试从 PNG/JPEG 头读取尺寸
  let width = 0;
  let height = 0;

  if (format === 'png') {
    // PNG IHDR chunk
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (format === 'jpeg') {
    // 简化的 JPEG 尺寸检测
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] === 0xFF) {
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          height = buffer.readUInt16BE(offset + 5);
          width = buffer.readUInt16BE(offset + 7);
          break;
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += length + 2;
      } else {
        offset++;
      }
    }
  }

  return { width, height, format, size };
}

/**
 * 获取图片
 */
async function fetchImage(url: string): Promise<{ data: Buffer; metadata: ImageAnalyzerOutput['metadata'] }> {
  try {
    // 使用动态导入避免类型问题
    const axios = (await import('axios')).default;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024, // 10MB
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = Buffer.from(response.data);
    const metadata = await getImageMetadata(data);

    return { data, metadata };
  } catch (error: any) {
    throw new Error(`获取图片失败: ${error.message}`);
  }
}

/**
 * 裁剪图片
 */
async function cropImage(
  buffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
  zoomLevel: number
): Promise<Buffer> {
  // 这里应该使用 sharp 或其他图像处理库
  // 为了简化，这里返回原图，实际项目中应该实现真正的裁剪
  console.log(`裁剪区域: (${region.x}, ${region.y}, ${region.width}, ${region.height}), 放大级别: ${zoomLevel}`);

  // 如果安装了 sharp，可以使用:
  // const sharp = require('sharp');
  // return await sharp(buffer)
  //   .extract(region)
  //   .resize(region.width * zoomLevel, region.height * zoomLevel)
  //   .toBuffer();

  return buffer;
}

/**
 * OCR 文字识别
 */
async function performOCR(
  imageData: Buffer,
  language: string
): Promise<Partial<ImageAnalyzerOutput>> {
  // 这里应该集成 OCR 服务，如 Tesseract.js 或云 OCR API
  // 简化实现，返回模拟结果

  console.log(`执行 OCR，语言: ${language}`);

  // 模拟 OCR 结果
  return {
    text: '[OCR 结果] 这里应该返回图片中的文字内容。\n\n在实际实现中，应该集成:\n1. Tesseract.js (本地 OCR)\n2. 百度/腾讯/阿里 OCR API\n3. Azure Computer Vision\n4. Google Vision API'
  };
}

/**
 * 代码分析
 */
async function analyzeCode(imageData: Buffer): Promise<Partial<ImageAnalyzerOutput>> {
  // 1. 先进行 OCR 提取代码
  const ocrResult = await performOCR(imageData, 'auto');
  const extractedText = ocrResult.text || '';

  // 2. 尝试识别代码语言
  const language = detectCodeLanguage(extractedText);

  // 3. 清理代码格式
  const code = cleanExtractedCode(extractedText);

  // 4. 生成简单解释
  const explanation = generateCodeExplanation(code, language);

  return {
    text: extractedText,
    code: {
      language,
      code,
      explanation
    }
  };
}

/**
 * 检测代码语言
 */
function detectCodeLanguage(text: string): string {
  const patterns: Record<string, RegExp[]> = {
    javascript: [/const\s+/, /let\s+/, /var\s+/, /function\s+/, /=>\s*\{/, /console\.log/],
    typescript: [/interface\s+/, /type\s+/, /:\s*(string|number|boolean)/, /export\s+class/],
    python: [/def\s+\w+\s*\(/, /import\s+\w+/, /print\s*\(/, /:\s*$/, /if\s+__name__\s*==/],
    java: [/public\s+class/, /private\s+\w+/, /System\.out\.print/, /void\s+main/],
    cpp: [/#include\s*</, /std::/, /cout\s*<</, /int\s+main\s*\(/],
    html: [/<!DOCTYPE\s+html>/i, /<html>/i, /<div>/i, /<script>/i],
    css: [/\{\s*[\w-]+\s*:/, /\.[\w-]+\s*\{/, /#\w+\s*\{/],
    sql: [/SELECT\s+.*\s+FROM/i, /INSERT\s+INTO/i, /CREATE\s+TABLE/i],
    bash: [/#!\/bin\/bash/, /echo\s+/, /export\s+/, /\|\s*grep/]
  };

  const scores: Record<string, number> = {};

  for (const [lang, regexes] of Object.entries(patterns)) {
    scores[lang] = regexes.reduce((score, regex) => {
      return score + (regex.test(text) ? 1 : 0);
    }, 0);
  }

  const detected = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .find(([_, score]) => score > 0);

  return detected ? detected[0] : 'unknown';
}

/**
 * 清理提取的代码
 */
function cleanExtractedCode(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * 生成代码解释
 */
function generateCodeExplanation(code: string, language: string): string {
  // 简化实现，实际应该使用 AI 生成
  const lines = code.split('\n').length;
  return `这是一个 ${language} 代码片段，约 ${lines} 行。代码包含 ${(code.match(/function|def|class/g) || []).length} 个函数/类定义。`;
}

/**
 * 错误分析
 */
async function analyzeError(imageData: Buffer): Promise<Partial<ImageAnalyzerOutput>> {
  // 1. OCR 提取错误信息
  const ocrResult = await performOCR(imageData, 'auto');
  const errorText = ocrResult.text || '';

  // 2. 分析错误类型
  const errorType = detectErrorType(errorText);

  // 3. 提取错误消息
  const errorMessage = extractErrorMessage(errorText, errorType);

  // 4. 生成修复建议
  const suggestedFix = generateFixSuggestion(errorType, errorMessage);

  return {
    text: errorText,
    error: {
      errorType,
      errorMessage,
      suggestedFix
    }
  };
}

/**
 * 检测错误类型
 */
function detectErrorType(text: string): string {
  const patterns: Record<string, RegExp[]> = {
    'SyntaxError': [/SyntaxError/, /Unexpected token/, /Invalid syntax/],
    'TypeError': [/TypeError/, /cannot read property/, /is not a function/],
    'ReferenceError': [/ReferenceError/, /is not defined/, /undefined/],
    'RuntimeError': [/RuntimeError/, /Exception/, /Error:/],
    'CompilationError': [/error:/, /failed to compile/, /build failed/i],
    'NetworkError': [/NetworkError/, /ECONNREFUSED/, /timeout/, /404|500/],
    'DatabaseError': [/SQL.*Error/, /database.*error/i, /connection.*refused/]
  };

  for (const [type, regexes] of Object.entries(patterns)) {
    if (regexes.some(regex => regex.test(text))) {
      return type;
    }
  }

  return 'UnknownError';
}

/**
 * 提取错误消息
 */
function extractErrorMessage(text: string, errorType: string): string {
  // 尝试提取错误消息的第一行
  const lines = text.split('\n');
  const errorLine = lines.find(line =>
    line.includes('Error') ||
    line.includes('error') ||
    line.includes('Exception')
  );

  return errorLine ? errorLine.trim() : text.substring(0, 200);
}

/**
 * 生成修复建议
 */
function generateFixSuggestion(errorType: string, errorMessage: string): string {
  const suggestions: Record<string, string> = {
    'SyntaxError': '检查代码语法，确保括号、引号成对出现，语句以分号或换行结束。',
    'TypeError': '检查变量类型，确保调用方法的对象不为 null/undefined，类型匹配。',
    'ReferenceError': '检查变量名拼写，确保变量已声明，检查作用域范围。',
    'RuntimeError': '检查运行时条件，添加错误处理逻辑，验证输入数据。',
    'CompilationError': '检查依赖安装，查看编译配置，确保语法符合语言规范。',
    'NetworkError': '检查网络连接，验证 URL 地址，检查服务端状态，添加重试机制。',
    'DatabaseError': '检查数据库连接配置，验证 SQL 语法，检查表结构，确认权限。',
    'UnknownError': '请提供更详细的错误信息以便分析。'
  };

  return suggestions[errorType] || suggestions['UnknownError'];
}

/**
 * 架构图分析
 */
async function analyzeDiagram(imageData: Buffer): Promise<Partial<ImageAnalyzerOutput>> {
  // 1. OCR 提取文本
  const ocrResult = await performOCR(imageData, 'auto');
  const text = ocrResult.text || '';

  // 2. 识别组件
  const components = extractDiagramComponents(text);

  // 3. 识别关系
  const relationships = extractDiagramRelationships(text);

  // 4. 识别图表类型
  const type = detectDiagramType(text);

  return {
    text,
    diagram: {
      type,
      components,
      relationships
    }
  };
}

/**
 * 提取架构图组件
 */
function extractDiagramComponents(text: string): Array<{ name: string; type: string; description?: string }> {
  const components: Array<{ name: string; type: string; description?: string }> = [];

  // 匹配常见的组件命名模式
  const patterns = [
    { regex: /(\w+(?:Service|Controller|Repository|Component|Module|Layer))/g, type: 'component' },
    { regex: /(\w+(?:DB|Database|Cache|Queue|API|Gateway))/gi, type: 'infrastructure' },
    { regex: /(Frontend|Backend|Client|Server|User|Admin)/gi, type: 'actor' }
  ];

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      if (!components.find(c => c.name === name)) {
        components.push({ name, type });
      }
    }
  }

  return components;
}

/**
 * 提取架构图关系
 */
function extractDiagramRelationships(text: string): Array<{ from: string; to: string; type: string }> {
  const relationships: Array<{ from: string; to: string; type: string }> = [];

  // 匹配箭头关系
  const arrowPatterns = [
    { regex: /(\w+)\s*[-=]+>\s*(\w+)/g, type: 'directed' },
    { regex: /(\w+)\s*<[-=]+\s*(\w+)/g, type: 'reverse' },
    { regex: /(\w+)\s*[-=]+\s*(\w+)/g, type: 'connected' }
  ];

  for (const { regex, type } of arrowPatterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      relationships.push({
        from: match[1],
        to: match[2],
        type
      });
    }
  }

  return relationships;
}

/**
 * 检测图表类型
 */
function detectDiagramType(text: string): string {
  const patterns: Record<string, RegExp[]> = {
    'architecture': [/architecture/, /system/, /component/, /service/],
    'flowchart': [/flow/, /process/, /start/, /end/, /decision/],
    'sequence': [/sequence/, /call/, /request/, /response/],
    'class': [/class/, /interface/, /inherit/, /extend/],
    'database': [/database/, /table/, /entity/, /relation/],
    'network': [/network/, /server/, /client/, /connection/]
  };

  for (const [type, regexes] of Object.entries(patterns)) {
    if (regexes.some(regex => regex.test(text))) {
      return type;
    }
  }

  return 'unknown';
}

/**
 * 通用分析
 */
async function analyzeGeneral(imageData: Buffer): Promise<Partial<ImageAnalyzerOutput>> {
  // 1. OCR 提取所有文本
  const ocrResult = await performOCR(imageData, 'auto');
  const textContent = ocrResult.text || '';

  // 2. 识别对象（简化实现）
  const objects = extractObjectsFromText(textContent);

  // 3. 生成描述
  const description = generateImageDescription(textContent, objects);

  return {
    text: textContent,
    general: {
      description,
      objects,
      textContent
    }
  };
}

/**
 * 从文本中提取对象
 */
function extractObjectsFromText(text: string): string[] {
  // 提取可能的实体名词
  const words = text.split(/\s+/);
  const objects = words.filter(word =>
    word.length > 2 &&
    /^[A-Z][a-z]+$/.test(word) // 大写开头的单词
  );

  return [...new Set(objects)].slice(0, 10);
}

/**
 * 生成图片描述
 */
function generateImageDescription(text: string, objects: string[]): string {
  const hasText = text.length > 0;
  const hasObjects = objects.length > 0;

  if (hasText && hasObjects) {
    return `图片包含文本内容和以下对象: ${objects.join(', ')}`;
  } else if (hasText) {
    return '图片主要包含文本内容';
  } else if (hasObjects) {
    return `图片包含以下对象: ${objects.join(', ')}`;
  }

  return '无法识别图片内容';
}

export default imageAnalyzer;
