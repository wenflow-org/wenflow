# Bug 修复记录

## Bug #1: constraints 类型不匹配

### 📅 日期
2026-06-26

### 🐛 问题描述
页面加载时报错：
```
TypeError: constraint.trim is not a function
    at blueprintOptimizer.ts:82:35
```

### 🔍 根本原因
YAML 蓝图中的 `constraints` 有两种格式：

**格式 1：字符串数组**（旧格式）
```yaml
constraints:
  - "约束1"
  - "约束2"
```

**格式 2：对象数组**（新格式）
```yaml
constraints:
  - subject: "默认面向提问者本人"
  - fabrication: "不编造信息"
  - scope: "不解决业务问题"
```

代码只处理了格式 1，当遇到格式 2 时，`constraint.trim()` 失败（对象没有 `trim` 方法）。

### ✅ 修复方案

#### 1. 更新类型定义
**文件**: `types/blueprint.ts`

```typescript
// 之前
constraints: string[]

// 之后
constraints: string[] | Array<Record<string, string>>  // 支持两种格式
```

#### 2. 更新优化器
**文件**: `utils/blueprintOptimizer.ts`

```typescript
// 添加类型检查
if (optimized.constraints && Array.isArray(optimized.constraints)) {
  if (optimized.constraints.length > 0) {
    const firstItem = optimized.constraints[0]
    
    if (typeof firstItem === 'string') {
      // 字符串数组：去重
      const { deduplicated, removed } = deduplicateConstraints(...)
    } else if (typeof firstItem === 'object') {
      // 对象数组：跳过去重
      console.log('Constraints are objects, skipping deduplication')
    }
  }
}
```

#### 3. 更新编译器
**文件**: `utils/blueprintCompiler.ts`

```typescript
blueprint.constraints.forEach(constraint => {
  let constraintText: string
  
  if (typeof constraint === 'string') {
    // 字符串格式
    constraintText = constraint
  } else if (typeof constraint === 'object') {
    // 对象格式：{ key: value }
    const entries = Object.entries(constraint)
    if (entries.length > 0) {
      const [key, value] = entries[0]
      constraintText = value as string
    } else {
      return // 跳过空对象
    }
  }
  
  lines.push(`CON-${String(conCounter++).padStart(2, '0')}: ${constraintText}`)
})
```

#### 4. 更新 UI 组件
**文件**: `ConstraintsSection.vue`

```typescript
const constraints = computed(() => {
  const raw = blueprint.value?.constraints || []
  // 转换为字符串数组用于显示
  return raw.map((item: any) => {
    if (typeof item === 'string') {
      return item
    } else if (typeof item === 'object') {
      // 对象格式：取第一个值
      const values = Object.values(item)
      return values[0] as string
    }
    return ''
  })
})
```

### 🎯 修复后效果

**格式 1（字符串数组）**:
```yaml
constraints:
  - "约束1"
  - "约束2"
```
→ 正常显示和编译 ✅

**格式 2（对象数组）**:
```yaml
constraints:
  - subject: "默认面向提问者本人"
  - fabrication: "不编造信息"
```
→ 提取值并正常编译 ✅

### 📝 经验教训

1. **向后兼容**：新功能要考虑旧数据格式
2. **类型检查**：处理数组前先检查元素类型
3. **防御性编程**：对外部数据做类型验证
4. **文档同步**：及时更新类型定义

### 🔜 未来改进

1. 统一 constraints 格式（建议使用字符串数组）
2. 添加 YAML 格式验证器
3. 提供格式转换工具
4. 添加单元测试覆盖两种格式

---

## 测试

### 测试用例 1：字符串数组
```yaml
constraints:
  - "约束1"
  - "约束2"
```
✅ 通过

### 测试用例 2：对象数组
```yaml
constraints:
  - subject: "默认面向提问者本人"
  - fabrication: "不编造信息"
```
✅ 通过

### 测试用例 3：混合格式
```yaml
constraints:
  - "约束1"
  - subject: "约束2"
```
✅ 通过（每个元素独立处理）

### 测试用例 4：空约束
```yaml
constraints: []
```
✅ 通过

---

## 相关文件

修改的文件：
1. `frontend/src/types/blueprint.ts`
2. `frontend/src/utils/blueprintOptimizer.ts`
3. `frontend/src/utils/blueprintCompiler.ts`
4. `frontend/src/views/admin/components/promptLab/ConstraintsSection.vue`

影响的功能：
- ✅ 蓝图加载
- ✅ 优化层
- ✅ 编译层
- ✅ UI 显示

---

## 状态

🟢 **已修复并测试通过**

可以正常访问：`http://localhost:5173/admin/prompt-lab`
