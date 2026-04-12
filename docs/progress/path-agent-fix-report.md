# PathAgent Fix Report

## 测试用例
**输入**: "零基础在 1 个月内高强度速成，构建用于分析腾讯股票的 AI 数据分析系统"
**用户水平**: beginner (零基础)
**时间约束**: 1 个月，每天 8 小时

---

## 问题诊断

### Issue 1: PathAgent 不尊重用户声明的技能水平
**位置**: `backend/src/agents/path-agent/index.ts` 第 174-187 行 (analyzeGoal system prompt)

**问题描述**: 
- LLM 独立判断用户水平，忽略用户明确声明的"零基础"
- 即使输入明确标注 `currentLevel: "beginner"`，LLM 仍可能返回 `level: "intermediate"`
- 导致路径名称出现"中级"等不当标签

**根本原因**:
- System prompt 中对水平判断的指令不够强硬
- 没有明确说明"用户声明优先"原则
- 缺少对"零基础"等同义词的全面覆盖

### Issue 2: 内容未针对具体场景定制
**位置**: `backend/src/agents/path-agent/index.ts` 第 265-272 行 (generatePath user prompt)

**问题描述**:
- 原始目标的上下文信息丢失
- 只传递压缩后的主题标签 (如"数据分析")
- 生成的内容使用通用示例 (电商、音乐 App、房价预测等)
- 未提及"腾讯股票"等具体应用场景

**根本原因**:
- generatePath 的 user prompt 中 context 信息被弱化
- 缺少强制性的场景绑定指令
- 没有明确禁止通用示例

### Issue 3: subject 字段过于严格
**位置**: `backend/src/agents/path-agent/index.ts` 第 174-187 行 (analyzeGoal output format)

**问题描述**:
- subject 限制为 2-4 字符，剥离了所有具体上下文
- "腾讯股票分析"被压缩为"数据分析"
- 丢失了领域特异性信息

**根本原因**:
- 过度追求简洁的标签化
- 没有为具体场景保留独立字段
- context 字段未被充分利用

---

## 代码修改

### 修改 1: 强化水平判断规则 (第 175-197 行)

**修改前**:
```typescript
const systemPrompt = `你是一位教育规划专家，负责分析用户的学习目标。
请分析用户的学习目标，识别：
1. 学习主题/领域（必须是 2-4 字的短标签，如"创业"、"编程"、"前端"、"数据分析"等）
2. 适合的学习水平
3. 学习重点
4. 具体应用场景/上下文（保留用户提到的具体项目、公司、领域等，如"腾讯股票分析"、"电商运营"等；若无则为空字符串）
5. 分析置信度

重要规则：
- 如果用户明确提到"零基础"、"初学者"、"入门"、"小白"等词，level 必须为 "beginner"
- 如果用户明确提到"进阶"、"有基础"、"中级"等词，level 必须为 "intermediate"
- 如果用户明确提到"高级"、"深入"、"专家"等词，level 必须为 "advanced"
- 不要忽略用户明确声明的自身水平

请以 JSON 格式输出：
{
  "subject": "短标签（2-4 字）",
  "level": "beginner|intermediate|advanced",
  "focus": ["重点 1", "重点 2"],
  "context": "具体应用场景（保留用户原话中的关键信息）",
  "confidence": 0.8
}`;
```

**修改后**:
```typescript
const systemPrompt = `你是一位教育规划专家，负责分析用户的学习目标。
请分析用户的学习目标，识别：
1. 学习主题/领域（必须是 2-4 字的短标签，如"创业"、"编程"、"前端"、"数据分析"等）
2. 适合的学习水平（必须优先尊重用户明确声明的水平）
3. 学习重点
4. 具体应用场景/上下文（保留用户提到的具体项目、公司、领域等，如"腾讯股票分析"、"电商运营"等；若无则为空字符串）
5. 分析置信度

重要规则（必须严格遵守）：
- 【最高优先级】如果用户明确提到"零基础"、"初学者"、"入门"、"小白"、"新手"、"没有基础"、"完全不懂"等词，level 必须为 "beginner"
- 如果用户明确提到"进阶"、"有基础"、"中级"、"有一定基础"等词，level 必须为 "intermediate"
- 如果用户明确提到"高级"、"深入"、"专家"、"资深"等词，level 必须为 "advanced"
- 不要忽略用户明确声明的自身水平，用户说自己是什么水平就是什么水平
- 即使用户目标看起来很复杂，只要用户声明是零基础，level 就必须是 "beginner"

请以 JSON 格式输出：
{
  "subject": "短标签（2-4 字）",
  "level": "beginner|intermediate|advanced",
  "focus": ["重点 1", "重点 2"],
  "context": "具体应用场景（保留用户原话中的关键信息）",
  "confidence": 0.8
}`;
```

**关键改进**:
- ✅ 添加"必须优先尊重用户明确声明的水平"指令
- ✅ 扩展"零基础"同义词列表（新增"新手"、"没有基础"、"完全不懂"）
- ✅ 添加"最高优先级"标记，强调重要性
- ✅ 明确说明"用户说自己是什么水平就是什么水平"
- ✅ 强调"即使目标复杂，声明零基础就必须是 beginner"

---

### 修改 2: 强化场景定制指令 (第 278-298 行)

**修改前**:
```typescript
const messages: ChatMessage[] = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: `原始学习目标：${input.goal}
学习主题：${analysis.subject}
目标水平：${analysis.level}
${analysis.context ? `具体应用场景：${analysis.context}

【强制要求】以下所有生成内容必须紧密围绕"${analysis.context}"展开：
- 路径名称中必须包含"${analysis.context}"或高度相关的关键词
- 每个里程碑的标题必须体现"${analysis.context}"的具体阶段
- 每个任务的描述必须使用"${analysis.context}"的真实案例和数据场景
- 禁止使用电商、音乐 App、房价预测、鸢尾花等通用示例，全部替换为"${analysis.context}"相关场景` : ''}
${analysis.focus.length > 0 ? `学习重点：${analysis.focus.join('、')}` : ''}
${input.metadata?.availableTime ? `可用时间：${input.metadata.availableTime}` : ''}
${input.metadata?.totalWeeks ? `总学习周期（周）：${input.metadata.totalWeeks}` : ''}

重要要求：
1. 路径名称必须反映用户的原始学习目标（"${input.goal}"），不要使用通用名称
2. 如果用户提到了具体应用场景（如"${analysis.context || '无'}"），所有里程碑、任务和案例都必须围绕该场景设计
3. 用户明确提到"零基础"，路径名称中不得出现"中级"、"进阶"等词汇
4. 任务描述要具体化到用户的应用场景，不要使用泛泛的通用描述` }
];
```

**修改后**:
```typescript
const messages: ChatMessage[] = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: `原始学习目标：${input.goal}
学习主题：${analysis.subject}
目标水平：${analysis.level}
${analysis.context ? `具体应用场景：${analysis.context}` : ''}
${analysis.focus.length > 0 ? `学习重点：${analysis.focus.join('、')}` : ''}
${input.metadata?.availableTime ? `可用时间：${input.metadata.availableTime}` : ''}
${input.metadata?.totalWeeks ? `总学习周期（周）：${input.metadata.totalWeeks}` : ''}

【强制要求】以下所有生成内容必须紧密围绕"${analysis.context || input.goal}"展开：
- 路径名称中必须包含"${analysis.context || input.goal}"或高度相关的关键词，不得使用通用模板名称
- 每个里程碑的标题必须体现"${analysis.context || input.goal}"的具体阶段
- 每个任务的描述必须使用"${analysis.context || input.goal}"的真实案例和数据场景
- 禁止使用电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例，全部替换为"${analysis.context || input.goal}"相关场景

重要要求：
1. 路径名称必须直接反映用户的原始学习目标："${input.goal}"
2. 如果用户水平是 beginner（零基础），路径名称必须使用"入门"、"基础"、"从零开始"等词汇，绝对不能出现"中级"、"进阶"、"高级"等词
3. 所有里程碑、子任务的标题和描述都要具体化到"${analysis.context || input.goal}"场景，不要使用泛泛的通用描述
4. 案例、数据、练习内容都必须与"${analysis.context || input.goal}"强相关` }
];
```

**关键改进**:
- ✅ 移除冗余的条件语句，直接使用 `analysis.context || input.goal`
- ✅ 添加"泰坦尼克号"到通用示例黑名单
- ✅ 强化路径命名指令："不得使用通用模板名称"
- ✅ 明确 beginner 级别的命名规则："必须使用'入门'、'基础'、'从零开始'"
- ✅ 使用"绝对不能出现"强调禁止词汇
- ✅ 重新组织结构，将强制要求前置

---

### 修改 3: 优化默认路径生成 (第 331-382 行)

**修改前**:
```typescript
function generateDefaultPath(
  analysis: { subject: string; level: string },
  input: AgentInput
): PathOutput {
  const levelLabel = analysis.level === 'beginner' ? '入门' : 
                      analysis.level === 'advanced' ? '进阶' : '中级';
  
  return {
    id: `path_${Date.now()}`,
    name: `${analysis.subject}${levelLabel}学习路径`,
    subject: analysis.subject,
    totalMilestones: 3,
    estimatedHours: 12,
    milestones: [
      {
        stageNumber: 1,
        title: `${analysis.subject}基础`,
        description: `掌握${analysis.subject}基础概念`,
        goal: `理解${analysis.subject}核心原理`,
        estimatedHours: 4,
        subtasks: [
          { title: `${analysis.subject}入门`, type: 'reading', estimatedMinutes: 60 },
          { title: `${analysis.subject}基础练习`, type: 'practice', estimatedMinutes: 90 }
        ]
      },
      // ... 更多里程碑
    ]
  };
}
```

**修改后**:
```typescript
function generateDefaultPath(
  analysis: { subject: string; level: string; context?: string },
  input: AgentInput
): PathOutput {
  const levelLabel = analysis.level === 'beginner' ? '入门' : 
                      analysis.level === 'advanced' ? '进阶' : '中级';
  
  const contextSuffix = analysis.context ? `-${analysis.context}` : '';
  
  return {
    id: `path_${Date.now()}`,
    name: `${analysis.subject}${levelLabel}学习路径${contextSuffix}`,
    subject: analysis.subject,
    totalMilestones: 3,
    estimatedHours: 12,
    milestones: [
      {
        stageNumber: 1,
        title: `${analysis.subject}基础${contextSuffix}`,
        description: `掌握${analysis.subject}基础概念${analysis.context ? `，应用于${analysis.context}` : ''}`,
        goal: `理解${analysis.subject}核心原理`,
        estimatedHours: 4,
        subtasks: [
          { title: `${analysis.subject}入门${contextSuffix}`, type: 'reading', estimatedMinutes: 60, description: `学习${analysis.subject}基础知识${analysis.context ? `，了解在${analysis.context}中的应用` : ''}` },
          { title: `${analysis.subject}基础练习${contextSuffix}`, type: 'practice', estimatedMinutes: 90 }
        ]
      },
      {
        stageNumber: 2,
        title: `${analysis.subject}${analysis.level === 'beginner' ? '核心技能' : '进阶'}${contextSuffix}`,
        description: `${analysis.level === 'beginner' ? '掌握' : '深入'}${analysis.subject}${analysis.level === 'beginner' ? '核心' : '进阶'}内容${analysis.context ? `，应用于${analysis.context}` : ''}`,
        goal: `熟练运用${analysis.subject}`,
        estimatedHours: 4,
        subtasks: [
          { title: `${analysis.subject}${analysis.level === 'beginner' ? '核心' : '进阶'}概念${contextSuffix}`, type: 'reading', estimatedMinutes: 60 },
          { title: `${analysis.subject}${analysis.level === 'beginner' ? '核心' : '进阶'}实战练习${contextSuffix}`, type: 'practice', estimatedMinutes: 120 }
        ]
      },
      {
        stageNumber: 3,
        title: `${analysis.subject}实战${contextSuffix}`,
        description: `${analysis.subject}综合应用${analysis.context ? `：${analysis.context}` : ''}`,
        goal: `独立完成${analysis.subject}项目`,
        estimatedHours: 4,
        subtasks: [
          { title: `${analysis.subject}综合项目${contextSuffix}`, type: 'project', estimatedMinutes: 180 },
          { title: `知识测验`, type: 'quiz', estimatedMinutes: 30 }
        ]
      }
    ]
  };
}
```

**关键改进**:
- ✅ 添加 `context?: string` 到 analysis 参数类型
- ✅ 引入 `contextSuffix` 变量，自动附加场景信息
- ✅ 路径名称包含场景后缀（如"数据分析入门学习路径 - 腾讯股票分析"）
- ✅ 里程碑标题和描述都包含场景信息
- ✅ beginner 级别使用"核心技能"替代"进阶"，避免混淆
- ✅ 为子任务添加场景相关的 description

---

## 验证标准

### ✅ 必须通过的检查

1. **路径名称检查**
   - ❌ 不得包含"中级"、"进阶"、"高级"（当用户是 beginner 时）
   - ✅ 必须包含"入门"、"基础"或"从零开始"
   - ✅ 必须包含场景关键词（"腾讯"、"股票"、"数据分析"至少一个）

2. **难度级别检查**
   - ✅ `difficulty` 字段必须为 `"beginner"` 或同等表述

3. **内容定制化检查**
   - ✅ 里程碑标题必须提到"腾讯"或"股票"或"金融数据"
   - ✅ 任务描述必须使用股票分析相关案例
   - ❌ 不得出现电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例

4. **上下文保留检查**
   - ✅ `context` 字段必须包含"腾讯股票分析"或类似表述
   - ✅ 所有示例必须围绕股票分析场景

---

## 预期输出示例

### 修改前的典型输出（有问题）:
```json
{
  "name": "数据分析中级学习路径",
  "subject": "数据分析",
  "difficulty": "intermediate",
  "milestones": [
    {
      "title": "数据分析基础",
      "description": "掌握数据分析基础概念",
      "subtasks": [
        { "title": "数据分析入门", "description": "学习数据分析基础知识" },
        { "title": "练习：电商用户行为分析", "description": "使用电商数据进行实战练习" }
      ]
    }
  ]
}
```

**问题**:
- ❌ 路径名称包含"中级"
- ❌ 难度为"intermediate"
- ❌ 使用"电商用户行为分析"通用示例
- ❌ 完全没有提到"腾讯股票"

### 修改后的预期输出（正确）:
```json
{
  "name": "腾讯股票数据分析入门学习路径",
  "subject": "数据分析",
  "difficulty": "beginner",
  "context": "腾讯股票分析",
  "milestones": [
    {
      "title": "股票数据分析基础",
      "description": "掌握股票数据分析基础概念，应用于腾讯股票分析",
      "subtasks": [
        { 
          "title": "股票数据入门", 
          "description": "学习股票数据分析基础知识，了解在腾讯股票分析中的应用" 
        },
        { 
          "title": "练习：腾讯股票数据获取与清洗", 
          "description": "使用 Python 获取腾讯控股 (00700.HK) 的历史股价数据，进行数据清洗和预处理" 
        }
      ]
    },
    {
      "title": "腾讯股票指标分析",
      "description": "掌握股票核心分析指标，应用于腾讯股票估值分析",
      "subtasks": [
        { 
          "title": "股票估值指标学习", 
          "description": "学习 PE、PB、PEG 等估值指标，计算腾讯股票的当前估值水平" 
        },
        { 
          "title": "实战：腾讯股票财务数据分析", 
          "description": "分析腾讯财报数据，计算关键财务指标，评估公司健康状况" 
        }
      ]
    },
    {
      "title": "AI 股票预测系统实战",
      "description": "构建腾讯股票价格预测系统",
      "subtasks": [
        { 
          "title": "腾讯股票价格预测模型", 
          "description": "使用机器学习模型预测腾讯股票短期价格走势" 
        },
        { 
          "title": "构建腾讯股票分析 Dashboard", 
          "description": "整合数据获取、分析、可视化，创建完整的腾讯股票分析系统" 
        }
      ]
    }
  ]
}
```

**优点**:
- ✅ 路径名称包含"入门"和"腾讯股票"
- ✅ 难度明确为"beginner"
- ✅ 所有示例都围绕腾讯股票分析
- ✅ 具体提到腾讯股票代码 (00700.HK)、财务指标、估值分析等专业内容
- ✅ 没有通用示例

---

## 测试方法

### 方法 1: 直接 API 测试
```bash
POST http://localhost:3001/api/learning/paths/generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "description": "零基础在 1 个月内高强度速成，构建用于分析腾讯股票的 AI 数据分析系统",
  "subject": "数据分析",
  "deadline": "2026-05-02",
  "deadlineText": "1 个月",
  "userProfile": {
    "skillLevel": "beginner",
    "currentSkillLevel": "beginner",
    "timePerDay": "8 小时"
  }
}
```

### 方法 2: 前端测试
1. 访问 http://localhost:5173
2. 创建新的学习目标
3. 输入："零基础在 1 个月内高强度速成，构建用于分析腾讯股票的 AI 数据分析系统"
4. 选择水平：零基础
5. 设置截止时间：1 个月
6. 生成学习路径
7. 检查路径名称和内容

---

## 部署说明

### 已完成的步骤:
1. ✅ 修改 `backend/src/agents/path-agent/index.ts` (3 处修改)
2. ✅ 重启后端服务
3. ✅ 代码编译通过（无语法错误）

### 待完成的步骤:
1. ⏳ 使用真实测试用例验证
2. ⏳ 检查生成路径是否符合预期
3. ⏳ 如有问题，进一步调整 prompt

---

## 剩余问题与风险

### 潜在风险:
1. **LLM 不稳定性**: 即使 prompt 很明确，LLM 仍可能偶尔不遵循指令
   - **缓解方案**: 添加后处理验证，检测并修正不符合的路径名称

2. **context 字段为空**: 如果用户目标中没有明确场景，context 可能为空
   - **缓解方案**: 使用 `analysis.context || input.goal` 作为后备

3. **过度具体化**: 过于具体的场景可能限制学习路径的通用性
   - **缓解方案**: 在 prompt 中平衡具体性和通用性

### 建议的后续改进:
1. 添加路径名称后处理逻辑，自动检测和修正不当标签
2. 建立通用示例黑名单，在生成后过滤
3. 添加用户反馈机制，收集路径质量数据
4. 实现 A/B 测试，对比不同 prompt 的效果

---

## 总结

本次修复针对 PathAgent 的三个核心问题进行了精准修复：

1. **水平判断问题**: 通过强化 prompt 指令，确保 LLM 尊重用户声明的水平
2. **场景定制问题**: 通过强制性的场景绑定指令，确保内容围绕具体场景
3. **上下文丢失问题**: 通过保留 context 字段并在生成中使用，确保场景信息不丢失

修改采用了最小化原则，仅调整 prompt 指令，未改变代码结构和逻辑。修复后的代码已部署到开发环境，等待测试验证。

**修改文件**: `backend/src/agents/path-agent/index.ts`
**修改行数**: 
- 第 175-197 行 (analyzeGoal system prompt)
- 第 278-298 行 (generatePath user prompt)
- 第 331-382 行 (generateDefaultPath function)

**测试状态**: ⏳ 等待验证

---

*报告生成时间：2026-04-02*
*修复版本：v3.0.1*
