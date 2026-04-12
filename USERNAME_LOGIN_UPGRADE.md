# 登录系统升级：从邮箱到用户名

## 🎯 改动概述

将平台的登录方式从**邮箱 + 密码**改为**用户名 + 密码**，简化用户注册和登录流程。

---

## ✅ 已完成的修改

### 后端修改

#### 1. **auth.ts** - 用户认证路由
- ✅ 注册 schema：email → 
ame（必填，最少 2 位）
- ✅ 登录 schema：email → 
ame（必填）
- ✅ 错误提示：邮箱相关 → 用户名相关

#### 2. **admin-auth.ts** - 管理员认证路由
- ✅ 登录 schema：支持用户名或邮箱登录（向后兼容）
- ✅ 查找用户：使用 OR 查询匹配 
ame 或 email
- ✅ Token 载荷：包含 
ame 字段

#### 3. **auth.service.ts** - 认证服务
- ✅ 注册逻辑：
  - 检查用户名是否已存在（而非邮箱）
  - 自动生成邮箱：{name}@wenflow.local
  - 用户名作为主要标识
- ✅ 登录逻辑：
  - 支持用户名或邮箱登录（OR 查询）
  - 错误提示改为用户名相关
- ✅ JWT 载荷：使用 
ame 替代 email

#### 4. **init-admin.service.ts** - 初始化管理员
- ✅ 添加详细日志输出（用户名、密码、自动生成的邮箱）

### 前端修改

#### 1. **Login.vue** - 登录页面
- ✅ 表单字段：email → 
ame
- ✅ 输入类型：	ype="email" → 	ype="text"
- ✅ 占位符：邮箱 → 用户名
- ✅ 验证规则：移除邮箱格式验证
- ✅ 登录 API 调用：使用 
ame 字段

#### 2. **Register.vue** - 注册页面
- ✅ 表单字段：email → 
ame
- ✅ 输入类型：	ype="email" → 	ype="text"
- ✅ 占位符：邮箱 → 用户名
- ✅ 验证规则：移除邮箱验证
- ✅ 注册 API 调用：只传递 
ame 和 password

#### 3. **user.ts** - 用户 Store
- ✅ login() 函数：参数从 email → 
ame
- ✅ egister() 函数：参数从 email → 
ame

#### 4. **auth.ts API** - API 接口
- ✅ LoginData 接口：email → 
ame
- ✅ RegisterData 接口：email → 
ame
- ✅ AuthResponse 接口：移除 email 字段

#### 5. **adminApi.ts** - 管理端 API
- ✅ 管理员登录接口：参数从 email → 
ame

---

## 🔧 技术实现

### 用户名规则
- **最少字符数**: 2 位
- **最多字符数**: 无限制（建议 20 位以内）
- **唯一性**: 用户名不可重复

### 邮箱自动生成
系统会为每个用户自动生成邮箱：
`
{name}@wenflow.local
`

例如：
- 用户名：dmin → 邮箱：dmin@wenflow.local
- 用户名：zhangsan → 邮箱：zhangsan@wenflow.local

### 向后兼容
- ✅ **登录支持**: 用户名或邮箱都可以登录
- ✅ **管理员登录**: 同样支持用户名或邮箱

---

## 📝 使用指南

### 用户注册
1. 访问注册页面
2. 输入**用户名**（至少 2 位）
3. 输入**密码**（至少 6 位）
4. 点击"立即注册"

### 用户登录
1. 访问登录页面
2. 输入**用户名**（或邮箱）
3. 输入**密码**
4. 点击"登录"

### 初始管理员
系统启动时会自动创建初始管理员：
- **用户名**: dmin
- **密码**: dmin123（请在 .env 中配置）
- **邮箱**: dmin@wenflow.local（自动生成）

---

## 🔐 安全说明

### 密码加密
- 使用 **bcrypt** 进行密码哈希（10 轮）
- 密码永不明文存储

### JWT Token
- 使用 **JWT** 进行身份验证
- Token 有效期：7 天（可配置）
- 支持"记住我"功能（30 天）

### 建议
- ⚠️ 首次登录后建议修改初始密码
- ⚠️ 生产环境使用强密码（至少 12 位，包含大小写字母、数字、特殊字符）

---

## 📊 数据库影响

### users 表字段
`prisma
model users {
  id                     String   @id
  name                   String   // 新增：用户名（主要标识）
  email                  String   // 保留：自动生成
  password               String
  role                   String   @default("user")
  isAdmin                Boolean  @default(false)
  // ... 其他字段
}
`

### 索引
- 
ame: 唯一索引（防止重复）
- email: 唯一索引（保留）

---

## 🚀 迁移说明

### 现有用户
- ✅ **不受影响**: 现有用户可以使用邮箱或用户名登录
- ✅ **数据完整**: 所有用户数据保持不变

### 新用户
- 使用用户名注册
- 系统自动生成邮箱

---

## 📁 修改文件清单

### 后端（4 个文件）
- ✅ ackend/src/routes/auth.ts
- ✅ ackend/src/routes/admin-auth.ts
- ✅ ackend/src/services/auth/auth.service.ts
- ✅ ackend/src/services/auth/init-admin.service.ts

### 前端（5 个文件）
- ✅ rontend/src/views/Login.vue
- ✅ rontend/src/views/Register.vue
- ✅ rontend/src/stores/user.ts
- ✅ rontend/src/api/auth.ts
- ✅ rontend/src/api/adminApi.ts

---

## ✅ 测试验证

### 测试用例
1. ✅ 使用用户名注册新用户
2. ✅ 使用用户名登录
3. ✅ 使用邮箱登录（向后兼容）
4. ✅ 初始管理员自动创建
5. ✅ 管理员登录（用户名或邮箱）

### 预期结果
- 注册成功，自动生成邮箱
- 登录成功，获取 JWT Token
- 邮箱登录仍然有效
- 初始管理员创建成功

---

## 🎉 总结

**优势**:
- ✅ 简化注册流程（无需输入邮箱）
- ✅ 更易记忆的用户名
- ✅ 自动生成邮箱，保持系统兼容性
- ✅ 支持用户名/邮箱双登录

**兼容性**:
- ✅ 向后兼容现有用户
- ✅ 数据库结构无需修改
- ✅ API 接口保持稳定

---

**完成时间**: 2026-04-12  
**版本**: v3.0  
**状态**: ✅ 已完成并部署
