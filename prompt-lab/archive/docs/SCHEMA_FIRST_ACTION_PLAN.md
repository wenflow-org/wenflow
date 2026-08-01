# Schema First 方向 - 行动计划

## 📅 当前状态（2026-06-26）

我们已经完成了 **Schema First** 的第一阶段工作。

---

## ✅ 今天完成的工作

### 1. 逆向工程分析
**文件**: `GOAL_CONVERSATION_ANALYSIS.md`

- ✅ 分析了 goal-conversation.yaml 的所有字段（~80 个）
- ✅ 分类：可配置 vs 固定模板 vs 可推导
- ✅ 识别出适合/不适合原子化的字段
- ✅ 发现了结构问题和冗余

**核心发现**：
> 大部分字段是领域知识的精确表达，不适合过度模板化

### 2. Schema 优化方案
**文件**: `SCHEMA_OPTIMIZATION_PROPOSAL.md`

- ✅ 设计了优化后的 Schema
- ✅ 减少了 12% 的字段数量
- ✅ 简化了层级结构（3 层 vs 4 层）
- ✅ 移除了冗余字段

**优化重点**：
- 简化元数据（移除 `skillId`, `temperature`, `maxTokens`）
- 重组 Identity（统一 `scope` 格式）
- 扁平化 Input（简化变量定义）
- 提取全局 Fabrication（避免重复）
- 合并 Output 的布尔字段（`strict` 替代 6 个 `no_xxx`）

### 3. 编译对比验证
**文件**: `SCHEMA_BEFORE_AFTER_COMPARISON.md`

- ✅ 展示了优化前后的 YAML 对比
- ✅ 验证了编译结果应该一致
- ✅ 列出了编译器需要的改动
- ✅ 提供了测试验证清单

---

## 📊 成果统计

### 文档
- 📝 **3 份核心文档**（分析 + 方案 + 对比）
- 📄 **约 2000 行文档**

### 分析
- 🔍 **80+ 个字段分析**
- 📋 **字段分类表**
- 🎯 **优化建议**

### 设计
- 📐 **新的 Schema 设计**
- 🔄 **编译规则定义**
- ✅ **验证清单**

---

## 🎯 核心洞察

### 1. Prompt Schema 的本质

我们设计的不是新语言，而是 **Prompt 的 IR（中间表示）**：

```
结构化 YAML (Source)
      ↓
  编译器 (Compiler)
      ↓
Markdown Prompt (Target)
      ↓
     LLM
```

### 2. 三层结构

```
固定模板层
  ├─ 章节标题
  ├─ 基础结构
  └─ 自动编号
      ↓
可配置层
  ├─ 简单原子（数值、枚举）
  └─ 复杂描述（自由文本）
      ↓
推导层
  ├─ 冗余字段
  └─ 固定措辞
```

### 3. 设计原则

**✅ Do**
- 保持 YAML 作为唯一源文件
- 减少冗余和重复
- 统一命名和层级
- 保留必要的自由文本配置

**❌ Don't**
- 不要过度原子化
- 不要强制模板化所有字段
- 不要引入新的 Source Module 文件
- 不要为了结构化而牺牲灵活性

---

## 🔜 下一步行动计划

### Phase 1: 验证编译器（最优先）

**目标**：验证当前编译器能否正确编译 goal-conversation

#### 任务清单
- [ ] 1. 编译当前的 goal-conversation.yaml
- [ ] 2. 对比编译结果和原 prompts/goal-conversation.md
- [ ] 3. 记录差异（如果有）
- [ ] 4. 分析差异原因

**预期结果**：
- 知道哪些部分编译正确
- 知道哪些部分需要改进
- 有清晰的改进方向

**工作量**：~2 小时

---

### Phase 2: 更新编译器（核心）

**目标**：让编译器支持优化后的 Schema

#### 任务清单
- [ ] 1. 更新类型定义（`types/blueprint.ts`）
- [ ] 2. 更新编译器（`utils/blueprintCompiler.ts`）
  - [ ] 支持 `id` 替代 `blueprintId`
  - [ ] 自动推导 `skillId`
  - [ ] 编译新的 `identity.scope` 格式
  - [ ] 编译简化的 `input.variables`
  - [ ] 编译重组的 `rules.context`
  - [ ] 编译提取的 `rules.fabrication`
  - [ ] 编译 `rules.stages` 结构
  - [ ] 编译 `output.strict`
  - [ ] 编译字符串数组 `constraints`
- [ ] 3. 添加单元测试
- [ ] 4. 验证编译结果

**预期结果**：
- 编译器能处理新旧两种格式
- 编译结果和原 Prompt 一致
- 有测试覆盖

**工作量**：~4-6 小时

---

### Phase 3: 迁移蓝图（实战）

**目标**：将 goal-conversation 迁移到优化后的格式

#### 任务清单
- [ ] 1. 创建迁移脚本（可选）
- [ ] 2. 手动创建优化后的 goal-conversation.yaml
- [ ] 3. 编译并验证
- [ ] 4. 对比新旧编译结果
- [ ] 5. 调整直到完全一致

**预期结果**：
- 有一个优化后的 goal-conversation.yaml
- 编译结果和原版完全一致
- 验证了 Schema 优化方案的可行性

**工作量**：~2-3 小时

---

### Phase 4: 更新 UI（适配）

**目标**：让 UI 编辑器支持新的 Schema

#### 任务清单
- [ ] 1. 更新 `IdentitySection.vue`
  - [ ] 支持新的 `scope` 格式
- [ ] 2. 更新 `RulesSection.vue`
  - [ ] 支持 `rules.context`
  - [ ] 支持 `rules.fabrication`
  - [ ] 支持 `rules.stages`
- [ ] 3. 更新 `OutputSection.vue`
  - [ ] 支持 `strict` 替代 `no_xxx`
- [ ] 4. 更新 `ConstraintsSection.vue`
  - [ ] 支持字符串数组格式（已完成）
- [ ] 5. 测试编辑和保存

**预期结果**：
- UI 能正确显示和编辑新格式
- 用户体验更好（字段更少）
- 实时编译正常工作

**工作量**：~3-4 小时

---

### Phase 5: 其他 Skill（扩展）

**目标**：分析和迁移其他 4 个 Skill

#### 任务清单
- [ ] 1. 分析 path-planning（路径规划）
- [ ] 2. 分析 teaching-turn（教学轮次）
- [ ] 3. 分析其他 2 个 Skill
- [ ] 4. 提取共同模式
- [ ] 5. 完善 Schema 规范
- [ ] 6. 迁移所有 Skill

**预期结果**：
- 5 个 Skill 都用统一的 Schema
- Schema 规范更完善
- 发现并解决了更多边缘情况

**工作量**：~2 天

---

## 📅 推荐时间线

### 本周（剩余时间）
- ✅ Day 1: 分析 + 方案（已完成）
- 🔜 Day 2: Phase 1 验证编译器

### 下周
- 🔜 Day 3-4: Phase 2 更新编译器
- 🔜 Day 5: Phase 3 迁移蓝图
- 🔜 Day 6: Phase 4 更新 UI
- 🔜 Day 7: Phase 5 其他 Skill

---

## 🎯 里程碑

### Milestone 1: 编译器验证 ✅
**定义**：当前编译器能编译 goal-conversation 并产生正确结果

**验收标准**：
- [ ] 编译成功，无错误
- [ ] 生成的 Markdown 和原版差异 < 5%
- [ ] 关键规则都被正确编译

---

### Milestone 2: Schema 优化 🔄
**定义**：编译器支持优化后的 Schema

**验收标准**：
- [ ] 所有新字段格式都能正确编译
- [ ] 有单元测试覆盖
- [ ] 文档完善

---

### Milestone 3: 实战验证 🔜
**定义**：goal-conversation 成功迁移到新 Schema

**验收标准**：
- [ ] 新格式的 YAML 编译结果和原版一致
- [ ] UI 能正确编辑新格式
- [ ] 实际测试通过（发送给 LLM）

---

### Milestone 4: 规范化 🔜
**定义**：所有 5 个 Skill 都迁移到新 Schema

**验收标准**：
- [ ] 5 个 Skill 都用统一格式
- [ ] Schema 规范文档完善
- [ ] 有迁移指南

---

## 💡 关键决策

### 决策 1: 不引入原子层 ✅
**原因**：goal-conversation 的规则太具体，不适合过度模板化

**影响**：
- 保持 YAML 作为唯一源文件
- 专注优化 YAML 结构本身
- 避免过度设计

### 决策 2: Schema First ✅
**原因**：先搞清楚数据结构，再考虑 UI 和工具

**影响**：
- 从分析现有 Prompt 开始
- 验证编译正确性
- 逐步迁移和优化

### 决策 3: 保留自由文本 ✅
**原因**：很多规则是精心设计的措辞，不应该模板化

**影响**：
- 不强制原子化
- 保留灵活性
- 专注减少冗余

---

## 📚 相关文档

### 核心文档
1. [GOAL_CONVERSATION_ANALYSIS.md](./GOAL_CONVERSATION_ANALYSIS.md) - 逆向工程分析
2. [SCHEMA_OPTIMIZATION_PROPOSAL.md](./SCHEMA_OPTIMIZATION_PROPOSAL.md) - 优化方案
3. [SCHEMA_BEFORE_AFTER_COMPARISON.md](./SCHEMA_BEFORE_AFTER_COMPARISON.md) - 对比验证

### 参考文档
4. [FINAL_SUMMARY.md](./FINAL_SUMMARY.md) - 今日总体总结
5. [MULTI_STAGE_COMPILATION.md](./MULTI_STAGE_COMPILATION.md) - 多阶段编译
6. [ARCHITECTURE.md](./ARCHITECTURE.md) - 三层架构

---

## 🤔 需要你的决策

### 问题 1: 优先级
你觉得应该：
- A. 先验证当前编译器（Phase 1）
- B. 直接开始更新编译器（Phase 2）
- C. 先手动创建优化后的 YAML（Phase 3）

**我的建议**：选 A，先验证当前状态，再决定改进方向

---

### 问题 2: 迁移策略
优化后的 Schema 要不要：
- A. 完全替代旧格式
- B. 两种格式共存（编译器支持两种）
- C. 渐进式迁移（先支持新格式，保留旧格式兼容）

**我的建议**：选 C，编译器同时支持两种格式，逐步迁移

---

### 问题 3: 原子化
要不要保留今天做的原子层（Stage 0 & 1）：
- A. 完全删除，专注 Schema 优化
- B. 保留代码，暂不使用
- C. 只用于简单字段（如 `max_questions_per_turn`）

**我的建议**：选 B，保留代码但不集成，等 Schema 稳定后再决定

---

## 🎉 总结

今天我们完成了从"原子化"到"Schema First"的战略转变：

### 之前的方向
```
原子（10个）→ 模块（6个）→ 蓝图 → 编译
```
**问题**：跳步太大，Schema 还没搞清楚

### 现在的方向
```
逆向工程 → Schema 优化 → 编译验证 → UI 适配
```
**优势**：务实、可验证、可演进

---

**下一步**：Phase 1 - 验证当前编译器

要不要我现在就开始 Phase 1，编译 goal-conversation.yaml 看看效果？
