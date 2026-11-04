# 模型配置的系统设计（从部署到 Skill 细调，含插件降级）

> 类型：设计方案（待评审）｜最后核验：2026-11-04
> 关联：`doc/MODEL_GATEWAY_DESIGN.md`（运行时网关 SSOT——本文只补充「怎么把模型配进来」，不重复解析链路）、`doc/SKILL_PROTOCOL_V4.md`、`doc/ADMIN_VISUAL_LAYER_SPEC.md`
> 适用范围：`backend/config/llm-providers.json`、`backend/src/services/{apiConfig,admin/model-providers,embedding}/`、`backend/src/routes/admin/{api-config,model-providers,infra-models,plugins,skill-model-configs}.ts`、`frontend/src/views/admin-redesign/{ApiConfig,ModelProvidersPanel,InfraModelsPanel,PullModelsDialog,ModelEditorDialog,Addons}.vue`、`skill-design/runtime-tab.vue`

---

## 0. 一句话结论

**把「模型配置」拆成两件事：谁能连（连接/密钥，进 DB 密文）、有哪些模型（清单/能力/限额，进 git 文件）。**
对话 / 向量 / 重排三块共用同一套「连接条 + 拉取 + 勾选」的交互，只是各自向上游 `/v1/models` 拉一份、按角色过滤后让用户挑自己要的那几个——**平台不维护上游全量表**。Skill 默认全部「跟随平台默认」，只在需要时覆盖。插件同构：每个通道一条「主用 → 备用」有序链，链就是降级。

但**现状有一个致命断点**必须先修：UI 上填完地址和密钥、挂好模型后，**没有任何地方设置「平台默认模型」**（这一块 2026-10-28 被整块撤掉了，`ApiConfig.vue:317-318`），而运行时只认 DB 的 `platform_api_configs.defaultModel`（`router.ts:556-589`），拿不到就抛 `AI model is not configured`（`router.ts:153-158`）。也就是说：**不配 environment 模型、纯靠 UI 走完他描述的流程，第一发 LLM 调用就会挂。** 这是本设计的 P0。

---

## 1. 背景与目标（用户口径）

用户描述的完整动线：

1. 部署时可在环境里配 API 端点与模型（**脚本还不完善**）；不配模型也能启动；但**必须配管理员账号密码**才能进管理台。
2. 进管理台后 UI 配置：**第 1 步填 API Key → 拉取模型**（大部分网关会返回模型清单）。
3. 模型分三块——**对话 / 向量(embedding) / 重排(rerank)**，每块**各自独立拉取**；返回结果可能很多，**平台不维护这张全量表**，用户只挑自己需要的放进对应位置。
4. 平台侧把需要的模型配好（对话可能配 3~4 个）。
5. 再去 **Skill 里细调**；但因为开发时只用了 DeepSeek-V4.1 一个模型，**Skill 基本都跟平台默认走**。
6. **思考模式 / 思考强度 / 能力（读图等）由用户自己勾选**——用户必须清楚自己的模型有什么能力。
7. 这些配置**最后落到本地文件吗？同步读取吗？**
8. 插件里的配置也是同样的顺序；插件还有**降级**，一并设计。

设计目标：让他这 8 步在 UI 上走得通、走得顺，且每一步的「配置真相」都有唯一落点、可热生效、可 git 审查。

---

## 2. 现状（事实 + 证据）

### 2.1 四份配置各存各的，没有统一叙事

| 配置 | 落地位置 | 读法 | 证据 |
|---|---|---|---|
| 对话/推理模型清单 + 能力 + 限额 + 单价 | **`backend/config/llm-providers.json`（git 跟踪）** | 启动时 `readFileSync` 同步读入内存；每次解析前 `statSync` 比 mtime，变了才重读 → **热生效、无需重启** | `src/config/models.config.ts:451-466`（initFromDisk 在模块 import 时执行）、`:475-498`（mtime 门控重载） |
| 平台连接（Base URL / API Key）+ 平台默认模型 + 可靠性 | **DB `platform_api_configs`**（key AES-256-GCM 密文，AAD=`system.platform_api_configs.apiKey`） | 路由每次 `findFirst`（有 60s 缓存，写后失效） | `prisma/system/schema.prisma:99-125`；`src/services/apiConfig.service.ts`；`router.ts:556-589` |
| 自定义供应商密钥（BYOK） | **DB `provider_secrets`**（密文） | 60s 进程内缓存 + 写后失效 | `src/services/provider-secrets.service.ts` |
| **向量 / 重排** | **DB `platform_settings.infraModels`（JSON）** + 密钥 `provider_secrets`（`infra-embedding`/`infra-rerank`） | 启动 `hydrate` 成进程快照，保存时再 `hydrate` | `src/services/embedding/infra-config.ts:17-47`；`infra-config.service.ts:143-204` |
| 插件供应商（目录=类型定义，值+顺序=平台设置） | **代码 `src/config/plugin-providers.ts`** + 值落 `platform_settings` | 每次读 DB / 代码常量 | `src/config/plugin-providers.ts:43-200`；`src/services/plugin-providers.service.ts` |

**这条「四份各存各的」正是需要统一叙事的地方**：不是要合并存储，而是要一句话说清每份存什么、为什么——见 §3 的判定原则。

### 2.2 部署期脚本只写 4 个 env，且与运行时真相不同源

> **2026-11-04 更新**：这一节原本还记着两个缺陷，已修——脚本默认值曾写**已下线的模型 id**
> （`deepseek-v4-flash` / `deepseek-v4-pro`，写入 `.env` 后启动即命中「已下线」归一化），
> 现已改 `deepseek-v4.1-flash`；并且两个脚本与 `.env.production.example` 都补上了
> embedding / rerank 三个变量（留空 = 不启用语义层，不影响启动）。下面的「四个变量」按修订前记。

- `setup-env.ps1:108-154` 与 `docker-start.sh:167-214` 只往 `backend/.env` 写 `AI_API_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_MODEL_REASONING` 四个变量；`.env.production.example:47-50` 也只有这四个，**没有 embedding/rerank**。
- 运行时并不直接读这四个变量作为主路径——它们只是 `platform_api_configs` 为空时的**兜底**（`router.ts:594-611` `getFallbackConfig`、`apiConfig.service.ts:37-42` 作为默认对象）。真正生效的是 DB 行。
- 结论：**env 与 UI 不是同一份真相**。env 只是「初始化 DB 默认值」的种子。用户说「脚本还不完善」，本质就是这条种子链没有闭环（写了 env 却不保证落成 DB 行，embedding/rerank 完全没种）。

### 2.3 不配模型能启动，但「进不去管理台」的判据是管理员账号

- `backend/src/bootstrap/seeds.ts:61` `未创建初始管理员：未配置 INIT_ADMIN_PASSWORD` —— 用户名/密码（`INIT_ADMIN_NAME`/`INIT_ADMIN_PASSWORD`）是唯一硬门槛，符合用户描述。
- 模型缺失不阻断启动：`llm-providers.json` 缺失 → 内置兜底目录（`models.config.ts` buildEmbeddedFallback），env 全空也能起，只是调用时会报错（见 2.4）。

### 2.4 **致命断点：UI 无法设置平台默认模型**

- 运行时默认模型只认 DB `platform_api_configs.defaultModel`（`router.ts:560` `resolveModel(config.defaultModel, …)`）；`defaultModel` 为空且 env `AI_MODEL` 为空 → `router.ts:155-157` 直接 `throw new Error('AI model is not configured. Set admin defaultModel or AI_MODEL.')`。
- 文件 `defaults.chat` 只是**展示/校验**，运行时不读（`MODEL_GATEWAY_DESIGN.md:24-25` 2026-10-24 补记）。
- 而管理台 **2026-10-28 把「平台默认与别名」整块撤出**（`ApiConfig.vue:317-318`：`平台默认与别名……整块撤出`），模型编辑也明说不碰 defaults（`services/admin/model-providers.service.ts:16`）。`PUT /admin/api-config` 虽仍接受 `defaultModel`（`routes/admin/api-config.ts:110-115`），**但 UI 不再有这个入口**。
- ⇒ **纯 UI 部署（不写 env AI_MODEL）走完 §1 的 1~4 步后，`defaultModel` 仍为空，第一次 LLM 调用必挂。** 用户描述的「先填 key、拉模型、挑模型」流程，缺了最后「钉一个默认」这一步。

### 2.5 三块模型的现状：只有「对话」是「拉取 + 勾选」，向量/重排是「手填 + 固定 bge」

- 对话：`获取模型` → `POST /admin/api-config/test` 拉 `/v1/models`（`apiConfig.service.ts:236-249`，`normalizeBase` 补 `/v1/models`），成功后**顺便把连接落盘**再开挑选弹窗（`ApiConfig.vue` 的 `fetchModels`）。挑选弹窗三页签「可引入 / 已添加 / 非对话模型」，只有 `role==='chat'` 可勾（`PullModelsDialog.vue:217-221`）。
- 向量/重排：`InfraModelsPanel.vue` 两张单例卡，**没有「拉取」**，模型 ID 手填，默认 `BAAI/bge-m3` / `BAAI/bge-reranker-v2-m3`（`infra-config.ts:46-47`），provider 只支持 `bge`（`infra-config.ts:143-145`）。
- ⇒ 用户要的「三块各自独立拉取」，现状只实现了 1/3。**这是本设计要补的第二块（P1）。**

### 2.6 能力元数据：现在是「按模型名猜完静默落盘」，与用户「让用户自己勾」相反

- `modelCapabilityInference.ts:19-60` 用一串正则从模型 **id 字符串**猜 `role`（image/rerank/embedding/chat）与 `supportsThinking/supportsReasoningEffort/vision/code/tool`。
- `ModelProvidersPanel.vue:534-542` 在批量「添加模型」时**直接把推断值写进注册表**（注释：「标签按模型名推断后随写入落盘」），用户**没有被逐模型确认**。
- 但用户明确要求：「让用户自己去勾选，因为他自己一定要清楚他的模型有什么能力」。⇒ 推断应降级为**预填建议 + 一键确认**，而不是静默真相。

### 2.7 Skill 级：默认「跟随平台默认」已是现状，且是好的

- `skill_model_configs`（`schema.prisma:148-174`）字段全：`model?/thinkingMode?/reasoningEffort?/endpoint?/apiKey?/requestTimeoutMs?/maxLogicalRetries?/paramOverrides?/fallbackChain?`。
- 默认 `model IS NULL` = 继承平台默认（`MODEL_GATEWAY_DESIGN.md:27`）；`runtime-tab.vue` 有「覆盖平台默认」开关，关着就全跟平台默认。**这正是用户要的「Skill 基本都跟平台默认」**，无需改。要改的是 §2.4——先让「平台默认」真的存在。

### 2.8 插件：四个通道**都已经**是「有序 provider 链 = 降级」，无需改造

> **2026-11-04 复核更正**：本节初稿写的是「web 有真降级，decision/image 只有单 provider、没有多
> provider 降级」——**这是错的**。逐处读代码后：decision 与 image 与 web 同构，都按
> `readPluginChannelOrder(...)` 拿到顺序后 `for (const id of order) { try … }` 逐个尝试、
> 失败打「尝试降级」日志（`decision.service.ts:63-79`、`image.service.ts:39-60`）。
> 真正的差别只是**已实现的 provider 数量**，不是机制。

- 目录 `plugin-providers.ts` 定义三组插件：**联网(web)**（搜索/抓取两通道，TinyFish/Tavily/Exa）、**决策(decision)**（阿里云/Cloudflare/Venice/OpenCode Zen/自建）、**生图(image)**（Agnes）。每个 provider 自带 `服务地址 + 模型 + 密钥`（`plugin-providers.ts:80-186`）。
- **配置面**：`orders: Record<channelId, providerId[]>` 按插件分通道存（`plugin-providers.service.ts:42,91-92,427-441`），`Addons.vue` 里拖 `主用 / 备用1 / 备用2` 即改这条链——**四个通道一视同仁**，不是只有联网能排。
- **运行面**：`web-search` / `fetch` / `decision` / `image` 四处服务都是「按链逐个 provider 尝试，失败自动降级」，同一个形状。
- **唯一的真实限制**：**生图目前只有 `agnes` 一个已实现 provider**（`image/providers/index.ts:14-16` 的 `KNOWN_PROVIDERS` 与 `IMPLEMENTED_PROVIDERS` 都只有它），所以它的链永远只有一项、**没有第二个可降级对象**。决策有 5 个已实现 provider，但默认链只放了 `alibaba` 一个（`DEFAULT_DECISION_PROVIDER_ORDER`）——用户可以在界面上把其余几个加进链。
- ⇒ 用户说的「插件还有一个降级」指的就是这条链，**它已经是现状**；要补的不是机制，而是「默认链只给一个」与「生图没有第二家」这两个事实的**说清**（见 §7）。

---

## 3. 判定原则（回答「到底落文件还是 DB、同步读吗」）

**一条规则，解释全部四份：**

> **形状与不含密钥的模型清单 → 文件（git，可审查、可服务器手改）；密钥与「这台机器选了哪个」 → DB（密文，不随仓库走）。**

据此：

- **对话/推理模型清单（含能力/限额/单价）→ `llm-providers.json`。** 它是「有哪些模型、各有什么能力」的**目录**，天然适合当代码审——加一个模型是一次可 review 的 diff；DB 被清空也能从 git 恢复。
  - **读取语义：启动同步读入内存 + mtime 门控热重载，无需重启。** 管理台是这份文件的**编辑器**（原子写 + 备份 10 份 + 失败回滚，`model-providers.service.ts:327-380`），不是第二个写源。回答用户：「是的，落到本地文件；同步读、改了自动生效。」
- **连接（Base URL / API Key）、平台默认模型、重试/RPM → DB。** 密钥绝不能进 git 文件。
- **向量/重排 → 保持 DB `infraModels` + 密钥 `provider_secrets`。** 理由同「密钥不进文件」。**但存在一个不对称**：对话的「模型能力」在文件，向量/重排的「模型选择」在 DB。这是可接受的——因为 embedding/rerank 在平台上是**单例必需配置**（就一个），不是可增删的模型墙，放 DB 更贴合「这台机器装了哪套引擎」。**要不要为对称把它也搬进 `llm-providers.json`，列为待决 D2。**
- **插件 → 目录（形状）在代码 `plugin-providers.ts`，值与顺序在 `platform_settings`。** 形状属于代码契约；具体填哪家、什么顺序属于部署决策。

一句话给用户：**「模型有哪些」在文件里（可 git 审、同步读、热生效）；「用哪把钥匙、默认哪一个」在数据库里（密文）。**

---

## 4. 目标形态：三块模型统一交互（回答 §1 的 2~4 步）

在现有「系统设置 → 模型与接入」宿主页内，把三块整理成**同构的三张卡**，每张都是「上：连接条 / 下：已挂载列表」两段（对话卡已是这个形态，向量/重排向它看齐）：

```
┌ 对话模型 ───────────────────────────────────────────────────────────┐
│ 灰底连接条  https://gw.example.com/v1 · 密钥已配置 · 上次获取 12:31  [连接设置] │
│  （未配置时原地就是：Base URL + API Key + [保存并拉取]）                       │
├────────────────────────────────────────────────────────────────────┤
│ 已挂载对话模型 (3)            已获取 36 个   [↻重新获取] [+添加模型] [手动录入] │
│  ● DeepSeek V4.1 Flash  思考·推理·读图  默认✓  [配置][测试][⋯]                │
│     输出 32k / 上限 131k / 并发 30                                           │
│  ○ Agnes 3.0 Flash      读图                   [配置][测试][⋯]                │
│  ○ GLM 5.3              —                      [配置][测试][⋯]                │
└────────────────────────────────────────────────────────────────────┘
┌ 向量模型（Embedding）──────────────────────────────────────────────┐
│ 连接：复用对话连接 ▾   已配置 BAAI/bge-m3 · 1024 维   [拉取][配置][测试]        │
└────────────────────────────────────────────────────────────────────┘
┌ 重排模型（Rerank）─────────────────────────────────────────────────┐
│ 连接：复用对话连接 ▾   未配置                         [拉取][配置][测试]        │
└────────────────────────────────────────────────────────────────────┘
```

**关键设计点：**

1. **三块共用一条「连接」，默认「复用对话连接」。** 大多数聚合网关一个 base URL + 一把 key 就能同时服务 chat/embedding/rerank。用户只需在对话卡填一次；向量/重排卡默认继承，需要独立服务时才切「独立服务」（`InfraModelsPanel` 已有 `connectionMode: inherit|own`，`infra-config.ts:23`，保留即可）。
2. **三块各自「拉取」同一份 `/v1/models`，按角色过滤。** 拉取端点不变（`/v1/models`）；把 `modelCapabilityInference` 的 `role` 分类用于**过滤分页签**——对话卡只看 `role==='chat'`，向量卡只看 `role==='embedding'`，重排卡只看 `role==='rerank'`。**平台不落库全量表**（符合用户「不维护这个表」）：拉取结果只活在弹窗里，确认后才把选中项写进各自存储。
3. **向量/重排新增「拉取」能力（目前没有）**：只把「上游模型 id 列表 + 角色过滤后的候选」呈现给用户挑选，provider 适配层仍是 `bge`；用户也可以「手动录入」（自建/别名）。**默认值 `BAAI/bge-m3` 从「隐藏默认」降级为「占位建议」。**
4. **钉默认（补齐 §2.4 断点）**：对话卡工具栏或行内提供「设为默认（对话）／设为默认（推理）」；至少保证**第一个挂载的对话模型自动成为默认**，并在卡头显示「当前默认：<id>」。写入 `platform_api_configs.defaultModel`（推理同理 `defaultReasoningModel`）。**这是 P0。**

---

## 5. 能力勾选：推断降级为「预填 + 确认」（回答 §1 第 6 步）

用户要「自己勾」，现状是「静默猜」（§2.6）。改：

- 添加模型（无论批量还是手动）时，弹出**逐模型的能力确认**：`思考 / 推理强度 / 读图 / 输出上限 / 默认输出 / 推理预留 / 并发上限 / 备用模型 / 单价`。
- 各勾选框**用推断值预填**并标注「按模型名推断，请确认」，用户可改；**只有用户确认后才落盘**。
- 未确认的能力一律保守（`false`/空），不做静默写入。运行时的能力闸门（`executor.ts` 的 `MODEL_VISION_UNSUPPORTED` 等）保持不变——声明错会被硬拦，这层保护正好和「用户要清楚自己模型能力」互补。

这条同时解决了「批量加 30 个模型每个都要手勾」的体验问题：**先按推断批量预填、再一键全确认，错的单独改。**

---

## 6. Skill 细调：默认继承，按需覆盖（回答 §1 第 5 步）

现状已符合（§2.7），设计只需明确「默认无感、例外才配」：

- **默认：Skill 不写模型 = `model IS NULL` = 跟随平台默认**。管理台 Skill「运行时」页开关默认关，读数显示「当前使用平台默认：DeepSeek V4.1 Flash」。
- **需要时**才打开覆盖：选模型 / 思考模式 / 思考强度 / temperature-topP-maxTokens 覆盖 / 超时 / 逻辑重试 / 备用链（≤2 跳）。
- 开发期只用 DeepSeek-V4.1 ⇒ 99% 的 Skill 无需任何模型配置，这应成为**默认体验**：Skill 列表 + 覆盖率视图里，绝大多数显示「平台默认」。
- **建议**：当平台只有 1 个对话模型时，Skill 的「覆盖」入口可折叠/弱化，避免「配了也等于没配」的认知负担；平台挂上第 2 个对话模型后再提示可覆盖。

---

## 7. 插件配置 + 降级（回答 §1 第 8 步）

**插件与模型同构：每个「通道」是一条有序 provider 链，链序即降级。**

```
┌ 联网 ────────────────────────────────────────────┐
│ 搜索   主用 TinyFish ▸ 备用1 Tavily ▸ 备用2 Exa     [配置] │
│ 抓取   主用 TinyFish ▸ 备用1 Tavily                [配置] │
└──────────────────────────────────────────────────┘
┌ 决策 ────────────────────────────────────────────┐
│ 判定   主用 阿里云MaaS ▸ 备用1 Cloudflare ▸ …      [配置] │
└──────────────────────────────────────────────────┘
┌ 生图 ────────────────────────────────────────────┐
│ 生成   主用 Agnes                                 [配置] │
└──────────────────────────────────────────────────┘
```

**降级设计（两层，别混）：**

1. **通道内 provider 降级（=「插件降级」用户所指）——已经在跑，不是待做项**（更正见 §2.8）：一条链里按顺序尝试、失败自动下一个，`web/fetch/decision/image` 四处同构（`web-search.service.ts:4,70`、`decision.service.ts:63-79`、`image.service.ts:39-60`）。每个 provider 自带地址 + 模型 + 密钥，换 provider 即换端点/密钥——这一点**比对话侧更强**（对话侧 fallback 只换模型名、不换端点，见 §8 风险）。
   - 要补的只是两个**事实的说清**，不是机制：① 决策有 5 个已实现 provider 而默认链只放了一个（界面可加）；② 生图只有一个已实现的 provider（`agnes`），**它的链永远只有一项**——用户若以为「配了备用就会降级」，需要对这一条明说。
2. **能力降级（插件停用/缺失时整步降级）**：某插件关闭或失败时，依赖它的那一步走「各卡标注的降级路径」（如资料包标为未找到），流水线继续跑而不是整条挂掉。这层是**行为约定**，不是用户可编辑配置，保持现状描述即可。

**配置顺序与模型一致**：先填 provider 的地址/密钥 → 测连通 → 选/排链 → 保存。UI 已具备（`Addons.vue` 的 `主用/备用` 拖拽 + 逐 provider 字段 + `orders` 持久化）。

---

## 8. 与运行时网关的衔接 / 已知风险

- **降级只换模型名、不换端点/密钥**（`MODEL_GATEWAY_DESIGN.md:279`；`model-registry.service.ts` `fallbackSwapsModelOnly: true`）⇒ 跨供应商 fallback 只在「单一聚合网关」拓扑下成立。若平台挂多个自带 `baseUrl` 的供应商，对话侧 fallback 会打到主模型端点上 404。**建议**：要么在 UI 上对「跨供应商备用链」直接禁用/警告，要么把 fallback 候选升级为「带 endpoint+key 的部署」（属网关层改造，另案）。
- **模型 id 未注册时**：解析链对裸 id 原样返回，调用时上游 400，不静默回落（`router.ts:152-159`）。前端「手动录入」需在保存时用注册表自洽检查提示（已有 `defaults` 自洽校验，可复用）。
- **`skill_model_configs` 历史覆盖行**：已有库里的旧 `model` 覆盖不会自动清空，需「批量模型配置 → 跟随平台默认」清（`MODEL_GATEWAY_DESIGN.md:27`）。
- **对话 fallback 候选上限 3（主+2 跳）**（`executor.ts:62` `MAX_MODEL_CANDIDATES=3`）——这是**运行时降级跳数**上限，不是「挂几个模型」的上限；对话卡挂 3~4 个模型完全没问题。用户不必担心「只能挂 3 个」。

---

## 9. 分阶段实施

| 阶段 | 内容 | 涉及文件 |
|---|---|---|
| **P0（阻塞）✅ 2026-11-04 已实现** | 恢复「平台默认模型」钉选：模型行 ⋯ 菜单出「设为默认（对话）/（推理）」，行内出「默认」徽章，工具栏出「默认：<id>」（缺省时琥珀警示）；**首个挂载模型自动成为默认**（只在默认为空时兜底，已有默认绝不改写）；删掉当前默认时自动改指下一个可用模型。写 `platform_api_configs.defaultModel/defaultReasoningModel`（`liveSetDefaultModel` 走既有 `PUT /api/admin/api-config`）。实测：把默认清空 → 刷新页面 → 自动种回 `deepseek-v4.1-flash`；行菜单改指 `agnes-3.0-flash` → 徽章与读数同步；连接有未保存改动时挡下设默认 | `ApiConfig.vue`、`ModelProvidersPanel.vue`、`live.ts` |
| **P1（能力确认）✅ 2026-11-04 已实现** | 能力从「按模型名推断后静默落盘」改为「推断只预填 + 用户核对确认」（用户「让用户自己去勾选，因为他自己一定要清楚他的模型有什么能力」）。批量添加走 `PullModelsDialog → ModelCapabilityConfirmDialog`：逐模型列出 思考 / 推理强度 / 读图 三勾，预填推断值、可改，确认后才写入注册表；手动录入仍走模型编辑器的能力区（本来就是用户自己勾） | `ModelProvidersPanel.vue`、新增 `ModelCapabilityConfirmDialog.vue` |
| **P1（向量/重排拉取）✅ 2026-11-04 已实现** | 向量 / 重排卡补「拉取」：配置弹层的模型 ID 旁加「拉取」，用这条能力的连接拉一份上游 `/v1/models`，按用途过滤（与对话侧同一套 `inferModelCapabilities`）后点选填入；独立服务可带草稿连接直接拉（不必先保存一次），但换地址后留空密钥一律拒绝、不回退旧密钥。新增 `POST /admin/infra-models/pull` + 纯函数 `resolveInfraModelsBaseUrl`（从 `…/v1/embeddings` 这类带类型路径的端点反推 base） | 新增 `routes/admin/__tests__/infra-models.pull.test.ts`（真实 express + fetch，6 例）；`InfraModelsPanel.vue`、`infra-models.ts`、`infra-config.ts`、`adminApi.ts` |
| **P2（部署脚本）✅ 2026-11-04 已实现** | 部署脚本闭环：`setup-env.ps1` / `docker-start.sh` 的默认模型 id 从**已下线**的 `deepseek-v4-flash` / `deepseek-v4-pro` 改为 `deepseek-v4.1-flash`（写入 `.env` 后启动会命中「已下线」归一化）；两个脚本与 `.env.production.example` 补 embedding / rerank 三个变量（**留空即不启用语义层，不影响启动**，只作首次部署种子与回落） | `setup-env.ps1`、`docker-start.sh`、`backend/.env.production.example` |
| **P2（插件）✅ 无需改造（2026-11-04 复核）** | 四个插件通道**都已经**是「有序 provider 链 = 降级」：配置面 `orders` 按插件分通道持久化、界面可拖「主用→备用」，运行面四处服务都按链逐个尝试、失败自动降级。初稿把它记成「decision/image 缺多 provider 降级」是**错的**，已在 §2.8 更正。剩下的是文案说清（决策默认链只放一家、生图只有一个已实现 provider） | —（如需文案，`Addons.vue` + `capabilityCatalog.ts`） |
| **P3（可选）** | 对称化：视 D2 决定 embedding/rerank 是否搬进 `llm-providers.json`；Skill 覆盖率视图弱化单模型时的覆盖入口 | — |

**验收锚点**：全新库、只配管理员账号、UI 里填 Base URL+Key → 拉取 → 挂 1 个对话模型 → **无需碰 env 即可完成一次真实 LLM 调用**（当前会因 §2.4 失败，修完应通过）。

> **P0 验收记录（2026-11-04）**：把 `platform_api_configs.defaultModel` 清空后刷新「模型与接入」页，
> 页面自动把首个挂载模型 `deepseek-v4.1-flash` 种回默认（工具栏读数与行内徽章同步），
> 行菜单改指 `agnes-3.0-flash` 后落盘生效、徽章随行移动；随后已还原现场。
> 前端 2012 用例、`vue-tsc`、copy / design 两道守卫通过。

---

## 10. 待决问题（需产品拍板）

- **D1 平台默认存哪**：恢复 UI 钉选写 DB `defaultModel`（推荐，贴合 2026-10-24「运行时默认=DB」的既有决定）／还是改成运行时读文件 `defaults.chat`？
- **D2 向量/重排是否搬进 `llm-providers.json`**：保持 DB `infraModels`（推荐，密钥不进文件、单例配置贴 DB）／还是为对称统一进文件？
- **D3 能力确认形态**：逐模型确认弹层（推荐）／还是保留静默推断但加「批量校对」入口？
- **D4 跨供应商备用链**：先只做「同网关警告 + 禁用」／还是排期做「带 endpoint+key 的部署级 fallback」（网关改造）？

---

## 附：需求 → 设计条目对照

| 用户原话（§1） | 本文章节 |
|---|---|
| ① 部署期 env 配端点/模型，脚本不完善 | §2.2、§9 P2 |
| ② 不配模型能启动，必须配管理员账号 | §2.3 |
| ③ 第 1 步填 API Key → 拉取模型 | §4 关键点 1/2、§2.5 |
| ④ 三块独立拉取、不维护全量表、只挑需要的 | §4 关键点 2/3 |
| ⑤ 平台侧配好（对话 3~4 个） | §4、§8（3 是降级跳数非挂载上限） |
| ⑥ 再去 Skill 细调，基本跟平台默认 | §6、§2.7 |
| ⑦ 思考/强度/能力用户自己勾 | §5、§2.6 |
| ⑧ 落本地文件吗？同步读吗？ | §3（是；同步读+热重载） |
| ⑨ 插件同样顺序；插件降级 | §7、§2.8 |
