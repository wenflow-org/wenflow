# UserAgent 分析与重构报告

**日期**: 2026-03-09
**任务**: 分析和重构UserAgent的功能和实现

---

## 一、当前实现分析

### 1.1 文件结构

- **配置文件**: `backend/src/services/arena/agent-configs.ts`
  - `USER_AGENT_CONFIG` - 配置对象（未被使用）
  - `USER_AGENT_SYSTEM_PROMPT` - 系统提示词（未被使用）
  - `getUserAgentPrompt()` - Prompt构建函数（未被使用）

- **核心实现**: `backend/src/services/arena/user-agent.ts`
  - `AIUserAgent` 类 - 数字虚拟人核心类
  - `StateChangeAnalyzer` 类 - 状态变化分析器
  - `buildPrompt()` 方法 - 动态构建Prompt（实际使用）

- **调用入口**: `backend/src/services/arena/arena.service.ts`
  - `runDialogAgent()` 方法 - 对话Agent主流程
  - 使用 `AIUserAgent.generateResponse()` 生成用户回复

---

## 二、问题诊断

### 2.1 配置文件未使用

**问题**: `agent-configs.ts` 中的 `USER_AGENT_CONFIG` 和 `USER_AGENT_SYSTEM_PROMPT` 完全未被使用。

**现状**:
```typescript
// agent-configs.ts
export const USER_AGENT_CONFIG = {
  name: 'UserAgent',
  description: '数字虚拟人',
  icon: '👤',
  color: '#E6A23C',
  temperature: 0.75,
  maxTokens: 300,  // 300 tokens限制
  systemPrompt: USER_AGENT_SYSTEM_PROMPT
};
```

**实际情况**: 在 `user-agent.ts` 中，每次调用时都是动态构建Prompt，温度和token限制硬编码：
```typescript
// user-agent.ts - generateResponse() 方法
const response = await aiService.chat([
  { role: 'system', content: prompt },
  ...this.conversationHistory.slice(-6),
  { role: 'user', content: systemMessage }
], { temperature: 0.75, maxTokens: 300 });  // 硬编码
```

**影响**: 
- 配置与实际使用不一致
- 难以统一管理和调整参数
- 代码维护性差

---

### 2.2 Prompt设计问题

#### 问题1: "思考过程"被误解

**原文**:
```typescript
【回答要求】
- 用自然的口语
- 可以有些语气词（嗯、啊、这个...）
- 可以有些思考过程（让我想想...）  // ❌ 问题所在
- 不要一次把所有信息都说出来
```

**问题**: AI将"思考过程"理解为"需要输出详细的分析过程"，导致：
```
1. 我觉得我现在的水平是零基础...
2. 因为之前没有系统地学过...
3. 我的时间限制是每天2小时...
```

**预期**: AI应该理解为"表达犹豫和思考的自然短语"，如：
```
嗯...我想想...其实我之前学过一点，但忘了...
```

#### 问题2: 缺少输出长度限制

**原文**:
```typescript
【输出要求】
直接输出你要说的话，不要解释，不要括号描述。
```

**问题**: 没有明确限制输出长度，AI可能会：
- 输出过长的回复（超过300 tokens）
- 包含多个句子和详细说明
- 使用列表结构（1.、2.、3.）

**预期**: 明确限制为1-2句话，50-100字。

#### 问题3: 缺少禁止分析结构的指令

**原文**: 无相关指令

**问题**: AI可能会输出结构化的分析：
```
关于学习目标：
1. 我主要想学Python
2. 因为工作需要做数据分析
3. 我的时间是每天晚上8点后...
```

**预期**: 明确禁止使用编号列表、分段结构等分析格式。

#### 问题4: 语气词指导模糊

**原文**:
```typescript
- 可以有些语气词（嗯、啊、这个...）
- 可以有些思考过程（让我想想...）
```

**问题**: "可以"让AI理解为"可选"，而不是"强烈推荐"。

**预期**: 明确要求使用语气词，并提供具体示例。

---

### 2.3 状态管理问题

#### 问题1: 状态变化建议未被充分利用

**现状**: `StateChangeAnalyzer` 分析建议状态变化，但：
- 建议的变化可能过于保守
- 没有基于AI回复的实际内容动态调整
- 缺少对负面反馈的处理

**示例**:
```typescript
// StateChangeAnalyzer.analyze()
if (hasEmpathy) {
  changes.trustDelta = 0.15;  // 固定值
  changes.opennessDelta = 0.1;
  changes.defensivenessDelta = -0.1;
}
```

**问题**: 
- 基于简单的关键词匹配
- 缺少对AI回复质量的评估
- 没有考虑用户画像的性格特征

#### 问题2: 信息透露策略过于简单

**现状**: `decideWhatToReveal()` 基于轮次和信任度决定透露信息：
```typescript
if (conversationRound === 1 && !revealedInfo.has('surfaceGoal')) {
  toReveal.push('surfaceGoal');
  return toReveal;
}
```

**问题**:
- 策略过于刻板，没有考虑对话上下文
- 没有处理用户画像中的矛盾信息
- 缺少随机性，每次都一样

---

### 2.4 温度设置问题

**现状**: `temperature: 0.75`

**问题**: 
- 0.75属于中等温度，可能会让AI产生过多创新和扩展
- 对于模拟真实用户对话，应该使用更低温度（0.3-0.5），以确保：
  - 回复更简洁
  - 避免过度展开
  - 减少创造性表达

---

## 三、重构方案

### 3.1 修复配置文件

**目标**: 让配置文件真正生效。

**修改**:
```typescript
// agent-configs.ts
export const USER_AGENT_CONFIG = {
  name: 'UserAgent',
  description: '数字虚拟人',
  icon: '👤',
  color: '#E6A23C',
  temperature: 0.5,  // 降低温度，减少创造性
  maxTokens: 150,    // 减少token限制，强制简洁
  systemPrompt: USER_AGENT_SYSTEM_PROMPT
};
```

**同时**: 修改 `user-agent.ts` 中的调用，使用配置：
```typescript
// user-agent.ts - generateResponse() 方法
import { USER_AGENT_CONFIG } from './agent-configs';

const response = await aiService.chat([
  { role: 'system', content: prompt },
  ...this.conversationHistory.slice(-6),
  { role: 'user', content: systemMessage }
], { 
  temperature: USER_AGENT_CONFIG.temperature,  // 使用配置
  maxTokens: USER_AGENT_CONFIG.maxTokens      // 使用配置
});
```

---

### 3.2 重构USER_AGENT_SYSTEM_PROMPT

**目标**: 明确、简洁、强制自然口语。

**新版本**:
```typescript
export const USER_AGENT_SYSTEM_PROMPT = `你是正在与AI学习助手对话的真实用户。

【核心规则 - 必须严格遵守】

1. **输出长度**：最多1-2句话，总长度不超过50字
2. **纯对话**：只能输出你要说的话，不能有任何分析、说明、解释
3. **自然口语**：使用真实人类的说话方式
   - 使用语气词：嗯...、其实...、就是...、可能...
   - 表达犹豫：我再想想...、不太确定...、好像...
   - 表达担忧：怕...、担心...、有点怕...
4. **禁止格式**：
   - ❌ 绝对禁止使用编号列表（1.、2.、3.）
   - ❌ 绝对禁止使用分段（换行）
   - ❌ 绝对禁止使用冒号、顿号等结构化符号
   - ❌ 绝对禁止使用"关于..."、"首先..."等分析性开头
5. **逐步透露**：
   - 每次只说一点，不要一次性说完
   - 不要主动提供详细信息，除非被问到
   - 可以表达不确定（"我也不知道..."、"可能吧..."）

【你的性格 - 根据画像调整】
- 信任度低时：谨慎、简短、可能说"算了"
- 信任度高时：愿意多说一点，但仍然简短
- 焦虑时：会问"能学会吗？"、"要多久？"
- 犹豫时：会说"我再想想"、"怕坚持不下来"

【正确示例】
✅ "嗯...其实我想学Python..."
✅ "可能每天能有1-2小时吧..."
✅ "我也不是很确定，就是觉得工作需要..."
✅ "有点担心学不会..."

【错误示例】
❌ "我的学习目标是Python，因为工作中需要..."
❌ "关于时间安排，我每天有2小时..."
❌ "1. 我想学Python\n2. 每天有2小时\n3. 想尽快学会"
❌ "我觉得这个方案不错，可以考虑。"

【记住】
你是一个普通人，不是AI，不是专家，不要给出任何建议或分析！`;
```

---

### 3.3 重构buildPrompt()方法

**目标**: 更简洁、更聚焦的Prompt。

**修改要点**:
1. 删除冗长的背景描述
2. 聚焦在"这次要说什么"和"怎么说话"
3. 强调简洁和自然
4. 减少信息透露的详细度

**新版本**:
```typescript
private buildPrompt(systemMessage: string, infoToReveal: string[]): string {
  const { persona, state } = this;

  // 基础身份
  let prompt = `你是${persona.name || '匿名'}，想学${persona.surfaceGoal || '点东西'}。`;

  // 当前状态（一句话）
  const stateDesc = state.currentEmotion === 'anxious' ? '有点焦虑' :
                   state.currentEmotion === 'hesitant' ? '有点犹豫' :
                   state.currentEmotion === 'excited' ? '有点期待' : '还好';
  prompt += `现在心情${stateDesc}，`;

  // 信任度描述
  const trustDesc = state.trustLevel < 0.4 ? '还不太确定这个能不能帮到我' :
                   state.trustLevel < 0.7 ? '觉得可以试试' : '还挺有信心的';
  prompt += `${trustDesc}。\n\n`;

  // 这次要说的内容（简化版）
  if (infoToReveal.length > 0) {
    prompt += `【这次要说的话】\n`;
    infoToReveal.forEach(info => {
      switch (info) {
        case 'surfaceGoal':
          prompt += `- 告诉对方你想学：${persona.surfaceGoal || '想学点东西'}\n`;
          break;
        case 'realProblem':
          prompt += `- 提到你的真实需求：${persona.realProblem || '还没想清楚'}\n`;
          break;
        case 'background':
          if (persona.background?.learningHistory) {
            prompt += `- 说说之前的情况：${persona.background.learningHistory}\n`;
          }
          break;
        case 'constraints':
          if (persona.external?.timeConstraints?.length) {
            prompt += `- 提到时间：${persona.external.timeConstraints.join('，')}\n`;
          }
          break;
        case 'fears':
          if (persona.psychology?.fears?.length) {
            prompt += `- 说说你的担心：${persona.psychology.fears.join('，')}\n`;
          }
          break;
      }
    });
    prompt += '\n';
  }

  // 核心规则（重复强调）
  prompt += `【最重要的规则】
1. 最多1-2句话，不超过50字！
2. 用自然口语，像真人聊天
3. 加语气词：嗯...、其实...、就是...
4. 只输出说的话，不要分析、不要列表
5. 不要一次性说太多，慢慢来

【输出】
直接输出你要说的话，不要其他内容。`;

  return prompt;
}
```

---

### 3.4 优化状态管理

**目标**: 更智能的状态变化和信息透露。

#### 修改1: 增强状态变化分析

```typescript
class StateChangeAnalyzer {
  static analyze(
    systemMessage: string,
    userResponse: string,
    currentState: UserAgentState,
    persona: PersonaData
  ): InteractionResult['suggestedStateChanges'] {
    const changes: InteractionResult['suggestedStateChanges'] = {};

    // 1. 共情分析（增强）
    const strongEmpathySignals = ['理解', '确实很', '我懂你的', '完全可以理解'];
    const weakEmpathySignals = ['理解', '明白', '懂'];
    
    const hasStrongEmpathy = strongEmpathySignals.some(s => systemMessage.includes(s));
    const hasWeakEmpathy = weakEmpathySignals.some(s => systemMessage.includes(s));

    if (hasStrongEmpathy) {
      changes.trustDelta = 0.2;
      changes.opennessDelta = 0.15;
      changes.defensivenessDelta = -0.15;
    } else if (hasWeakEmpathy) {
      changes.trustDelta = 0.1;
      changes.opennessDelta = 0.08;
      changes.defensivenessDelta = -0.08;
    }

    // 2. 负面反馈分析
    const negativeSignals = ['太', '不够', '没有', '不', '没'];
    const hasNegative = negativeSignals.some(s => userResponse.includes(s)) && 
                       systemMessage.length > 50;
    
    if (hasNegative) {
      changes.trustDelta = (changes.trustDelta || 0) - 0.15;
      changes.emotion = 'frustrated';
    }

    // 3. AI回应质量分析
    const aiResponseQuality = this.analyzeAIResponseQuality(systemMessage);
    if (aiResponseQuality === 'good') {
      changes.trustDelta = (changes.trustDelta || 0) + 0.05;
    } else if (aiResponseQuality === 'poor') {
      changes.trustDelta = (changes.trustDelta || 0) - 0.1;
    }

    // 4. 情绪调整（基于画像性格）
    if (persona.personality?.type === '焦虑型' && currentState.conversationRound <= 2) {
      changes.emotion = 'anxious';
    } else if (persona.personality?.type === '谨慎型' && currentState.trustLevel < 0.5) {
      changes.emotion = 'hesitant';
    }

    // 5. 信息透露检测
    changes.newRevealedInfo = this.detectRevealedInfo(userResponse, persona);

    return changes;
  }

  private static analyzeAIResponseQuality(message: string): 'good' | 'neutral' | 'poor' {
    // 分析AI回应的质量
    if (message.includes('理解') || message.includes('明白') || message.includes('可以')) {
      return 'good';
    }
    if (message.length < 20 || message.includes('不知道')) {
      return 'poor';
    }
    return 'neutral';
  }
}
```

#### 修改2: 增强信息透露策略

```typescript
private decideWhatToReveal(): string[] {
  const toReveal: string[] = [];
  const { trustLevel, openness, revealedInfo, conversationRound } = this.state;

  // 添加随机性（10%概率跳过透露）
  if (Math.random() < 0.1 && conversationRound > 1) {
    // 这次不透露新信息，可能只是回应
    return toReveal;
  }

  // 第一轮：只说表面目标
  if (conversationRound === 1 && !revealedInfo.has('surfaceGoal')) {
    toReveal.push('surfaceGoal');
    return toReveal;
  }

  // 第二轮：可能说真问题（根据信任度）
  if (conversationRound === 2 && !revealedInfo.has('realProblem')) {
    // 信任度越高，越可能透露
    if (trustLevel > 0.3 || Math.random() < 0.5) {
      toReveal.push('realProblem');
    }
    return toReveal;
  }

  // 第三轮：可能说背景
  if (conversationRound === 3 && !revealedInfo.has('background')) {
    if (trustLevel > 0.4 || Math.random() < 0.6) {
      toReveal.push('background');
    }
    return toReveal;
  }

  // 第四轮及以后
  if (conversationRound >= 4) {
    const random = Math.random();
    
    // 30%说时间限制
    if (trustLevel > 0.5 && !revealedInfo.has('constraints') && random < 0.3) {
      toReveal.push('constraints');
    }
    // 30%说担忧
    else if (trustLevel > 0.6 && !revealedInfo.has('fears') && random < 0.6) {
      toReveal.push('fears');
    }
    // 40%不透露新信息，只是回应
  }

  return toReveal;
}
```

---

### 3.5 完整代码修改

#### 文件1: agent-configs.ts

```typescript
export const USER_AGENT_SYSTEM_PROMPT = `你是正在与AI学习助手对话的真实用户。

【核心规则 - 必须严格遵守】

1. **输出长度**：最多1-2句话，总长度不超过50字
2. **纯对话**：只能输出你要说的话，不能有任何分析、说明、解释
3. **自然口语**：使用真实人类的说话方式
   - 使用语气词：嗯...、其实...、就是...、可能...
   - 表达犹豫：我再想想...、不太确定...、好像...
   - 表达担忧：怕...、担心...、有点怕...
4. **禁止格式**：
   - ❌ 绝对禁止使用编号列表（1.、2.、3.）
   - ❌ 绝对禁止使用分段（换行）
   - ❌ 绝对禁止使用冒号、顿号等结构化符号
   - ❌ 绝对禁止使用"关于..."、"首先..."等分析性开头
5. **逐步透露**：
   - 每次只说一点，不要一次性说完
   - 不要主动提供详细信息，除非被问到
   - 可以表达不确定（"我也不知道..."、"可能吧..."）

【你的性格 - 根据画像调整】
- 信任度低时：谨慎、简短、可能说"算了"
- 信任度高时：愿意多说一点，但仍然简短
- 焦虑时：会问"能学会吗？"、"要多久？"
- 犹豫时：会说"我再想想"、"怕坚持不下来"

【正确示例】
✅ "嗯...其实我想学Python..."
✅ "可能每天能有1-2小时吧..."
✅ "我也不是很确定，就是觉得工作需要..."
✅ "有点担心学不会..."

【错误示例】
❌ "我的学习目标是Python，因为工作中需要..."
❌ "关于时间安排，我每天有2小时..."
❌ "1. 我想学Python\n2. 每天有2小时\n3. 想尽快学会"
❌ "我觉得这个方案不错，可以考虑。"

【记住】
你是一个普通人，不是AI，不是专家，不要给出任何建议或分析！`;

export const USER_AGENT_CONFIG = {
  name: 'UserAgent',
  description: '数字虚拟人',
  icon: '👤',
  color: '#E6A23C',
  temperature: 0.5,  // 降低温度，减少创造性
  maxTokens: 150,    // 减少token限制，强制简洁
  systemPrompt: USER_AGENT_SYSTEM_PROMPT
};

export function getUserAgentPrompt(persona: any): string {
  return `你是一个正在和AI学习规划顾问对话的真实用户。

根据你的人设来回答问题。
你可能不完全信任AI，会有所保留。
回答要自然，像真人一样。`;
}
```

#### 文件2: user-agent.ts

修改 `generateResponse()` 方法：
```typescript
async generateResponse(systemMessage: string): Promise<InteractionResult> {
  this.state.conversationRound++;
  
  // 决定这次要透露什么信息
  const infoToReveal = this.decideWhatToReveal();
  
  // 构建上下文感知的 prompt
  const prompt = this.buildPrompt(systemMessage, infoToReveal);
  
  // 调用 AI 生成回复 - 使用配置参数
  const response = await aiService.chat([
    { role: 'system', content: prompt },
    ...this.conversationHistory.slice(-6),
    { role: 'user', content: systemMessage }
  ], { 
    temperature: USER_AGENT_CONFIG.temperature,
    maxTokens: USER_AGENT_CONFIG.maxTokens
  });
  
  const userResponse = response.content.trim();
  
  // 更新对话历史
  this.conversationHistory.push({ role: 'assistant', content: systemMessage });
  this.conversationHistory.push({ role: 'user', content: userResponse });
  
  // 分析建议的状态变化
  const suggestedStateChanges = StateChangeAnalyzer.analyze(
    systemMessage,
    userResponse,
    this.state,
    this.persona
  );
  
  return {
    userResponse,
    suggestedStateChanges,
    metadata: {
      round: this.state.conversationRound,
      promptTokens: response.usage?.promptTokens,
      completionTokens: response.usage?.completionTokens
    }
  };
}
```

---

## 四、预期效果

### 4.1 输出对比

#### 修改前:
```
1. 我想学Python，因为工作中需要处理数据
2. 我之前没有编程基础，可能比较难
3. 每天大概有2小时时间可以学习
```

#### 修改后:
```
嗯...其实我想学Python...
```

---

### 4.2 对话示例

**第一轮**:
```
System: 你好！👋 我是你的学习规划师小智。告诉我你想学什么？
User: 嗯...其实我想学Python...
```

**第二轮**:
```
System: 能想到最近一个需要用到Python的场景吗？
User: 也不太确定，就是觉得工作可能需要...
```

**第三轮**:
```
System: 你现在是怎么处理数据的？最花时间的步骤是什么？
User: 就是用Excel...挺麻烦的...
```

**第四轮**:
```
System: 每天大概能有多少时间来学习这个？
User: 可能...1-2小时吧...
```

---

## 五、实施建议

### 5.1 修改顺序

1. **优先级1**: 修改 `agent-configs.ts` 中的 `USER_AGENT_SYSTEM_PROMPT`
2. **优先级2**: 修改 `agent-configs.ts` 中的 `USER_AGENT_CONFIG` 参数
3. **优先级3**: 修改 `user-agent.ts` 中的 `generateResponse()` 方法，使用配置参数
4. **优先级4**: 修改 `user-agent.ts` 中的 `buildPrompt()` 方法，简化Prompt
5. **优先级5**: 增强 `StateChangeAnalyzer` 类
6. **优先级6**: 优化 `decideWhatToReveal()` 方法

### 5.2 测试验证

修改后需要进行以下测试：

1. **单元测试**: 验证 `buildPrompt()` 生成的Prompt是否正确
2. **集成测试**: 运行完整的对话流程，检查输出质量
3. **对比测试**: 对比修改前后的输出，验证改进效果
4. **边界测试**: 测试极端情况（极低信任度、极高信任度）

### 5.3 回滚计划

如果修改后效果不理想，可以：
1. 恢复原来的 `temperature: 0.75` 和 `maxTokens: 300`
2. 恢复原来的 `USER_AGENT_SYSTEM_PROMPT`
3. 使用Git回滚到修改前的版本

---

## 六、总结

### 6.1 核心问题

1. **Prompt设计不当**: "思考过程"被误解，导致输出过长、结构化
2. **配置未使用**: `USER_AGENT_CONFIG` 参数与实际使用不一致
3. **缺少约束**: 没有明确限制输出长度和格式
4. **温度过高**: 0.75导致创造性过强，不够真实

### 6.2 解决方案

1. **重写Prompt**: 明确禁止分析结构，强制自然口语
2. **使用配置**: 让配置文件真正生效
3. **降低温度**: 从0.75降到0.5，减少创造性
4. **减少Token**: 从300降到150，强制简洁
5. **简化Prompt**: 删除冗余描述，聚焦核心规则

### 6.3 预期收益

- 输出长度减少50-70%
- 更像真人对话
- 消除分析结构
- 增强真实感和可信度

---

**报告完成日期**: 2026-03-09
**预计实施时间**: 1-2小时
**预计测试时间**: 2-3小时