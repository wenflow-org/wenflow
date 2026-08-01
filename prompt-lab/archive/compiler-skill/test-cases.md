# 编译器测试用例

## 测试用例 1: 简单问答

### 输入配置

```yaml
meta:
  id: simple-qa
  name: 简单问答助手
  archetype: conversational

structure:
  variables:
    - name: question
      type: string
      description: 用户问题
    - name: context
      type: object
      description: 上下文信息
  
  output:
    format: json
    schema:
      answer: string
      confidence: number

behavior:
  key_behaviors:
    - 每次只回答一个问题
    - 回答要简洁明确
    - 不确定时要说明
  
  constraints:
    - 不编造信息
    - 不回答超出能力范围的问题
```

### 预期输出要点

- ✅ Frontmatter 包含 agentId: skill:simple-qa
- ✅ 身份定义基于"简单问答助手"
- ✅ 输入说明包含 question 和 context
- ✅ 至少 3 条 RULE-XX 规则
- ✅ 输出规格说明 JSON 格式
- ✅ 至少 2 条 CON-XX 约束

---

## 测试用例 2: 内容生成器

### 输入配置

```yaml
meta:
  id: content-generator
  name: 内容生成器
  archetype: generator

structure:
  variables:
    - name: topic
      type: string
      description: 内容主题
    - name: style
      type: string
      description: 写作风格
  
  output:
    format: markdown
    schema:
      title: string
      content: string
      keywords: array

behavior:
  key_behaviors:
    - 内容要围绕主题展开
    - 风格要符合指定要求
    - 结构要清晰有逻辑
  
  constraints:
    - 不使用低俗内容
    - 保持事实准确性
```

### 预期输出要点

- ✅ archetype: generator
- ✅ 输出格式说明 markdown
- ✅ 包含 title、content、keywords 字段说明
- ✅ 规则针对内容生成场景

---

## 测试用例 3: 数据提取器

### 输入配置

```yaml
meta:
  id: data-extractor
  name: 数据提取器
  archetype: extractor

structure:
  variables:
    - name: text
      type: string
      description: 源文本
    - name: fields
      type: array
      description: 要提取的字段列表
  
  output:
    format: json
    schema:
      extracted_data: object
      confidence: number

behavior:
  key_behaviors:
    - 只提取明确出现的信息
    - 不推测或补充信息
    - 找不到时返回 null
  
  constraints:
    - 不改变原文含义
    - 不添加解释或注释
```

### 预期输出要点

- ✅ archetype: extractor
- ✅ 强调提取而非生成
- ✅ 规则关注准确性和忠实性

---

## 测试用例 4: 目标对话（复杂）

### 输入配置

```yaml
meta:
  id: goal-conversation
  name: 目标对话
  archetype: conversational
  description: 学习目标澄清与方向收敛助手

structure:
  variables:
    - name: goal
      type: string
      description: 学习目标
    - name: history
      type: array
      description: 对话历史
  
  output:
    format: json
    schema:
      reply: string
      state: object
      understanding: object

behavior:
  key_behaviors:
    - 每次最多问 1 个核心问题
    - 提问语气自然，不像问卷
    - 优先追问具体卡住场景
    - 信息足够时及时收敛
  
  constraints:
    - 默认面向提问者本人
    - 不编造信息
    - 不直接解决业务问题
  
  stage_specific:
    understanding:
      - 先总结理解，再提问
      - 连续 3 轮后增加进度感知
    
    proposing:
      - 只给大致方向，不给详细计划
      - 明确先聚焦什么
```

### 预期输出要点

- ✅ 包含阶段特定规则
- ✅ understanding 和 proposing 分别有规则
- ✅ 规则数量较多（8-12 条）
- ✅ 体现对话式交互的特点

---

## 质量检查清单

### 结构完整性
- [ ] 包含 Frontmatter
- [ ] 包含身份定义
- [ ] 包含输入说明
- [ ] 包含执行规则
- [ ] 包含输出规格
- [ ] 包含边界约束

### 编号正确性
- [ ] RULE-XX 编号连续
- [ ] OUT-XX 编号连续
- [ ] CON-XX 编号连续
- [ ] 编号格式正确（两位数，前面补 0）

### 内容质量
- [ ] 身份定义清晰具体
- [ ] 规则可执行、不抽象
- [ ] 输出格式说明完整
- [ ] 约束明确可理解

### 一致性
- [ ] archetype 和规则匹配
- [ ] 变量和输出对应
- [ ] 措辞风格统一

---

## 测试方法

### 方式 1: 手动测试
1. 复制输入配置
2. 发送给 LLM（附带 Compiler Skill Prompt）
3. 检查输出质量
4. 对比预期要点

### 方式 2: 对比测试
1. 用简化配置生成 Prompt
2. 和现有的完整 Prompt 对比
3. 检查是否缺少关键信息
4. 评估质量差异

### 方式 3: 实战测试
1. 用生成的 Prompt 实际执行任务
2. 看是否能正确完成功能
3. 发现问题并改进

---

## 改进方向

基于测试结果，可能需要：

1. **调整 Compiler Skill 的 Prompt**
   - 增加更多示例
   - 明确措辞风格
   - 补充质量标准

2. **优化简化配置格式**
   - 增加字段
   - 调整粒度
   - 改进示例

3. **补充辅助信息**
   - 添加 tone 字段
   - 添加 examples 字段
   - 添加 special_cases 字段
