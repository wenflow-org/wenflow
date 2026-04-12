# AI 学习平台架构演进路线图 (Architecture Roadmap)

## 1. 核心愿景
从 **"文本生成的学习计划工具"** 进化为 **"多模态 AI 课件工厂与伴学平台"**。
核心能力：用户上传资料 -> AI 解析并教学化 -> 多模态互动学习。

## 2. 演进阶段

### Phase 1: 文本与意图驱动 (当前阶段)
- **核心交互**：聊天窗口 (Chat UI)。
- **内容形式**：Markdown 文本，结构化大纲。
- **能力**：意图识别、动态规划、文本任务生成。
- **关键技术**：LLM (DeepSeek), Prompt Engineering, State Machine。

### Phase 2: 知识摄入与 RAG (近期规划)
- **场景**："我有一本 PDF，教我学里面的内容。"
- **新增模块**：
  - **File Ingestion**：支持 PDF/PPT/MD 上传。
  - **Parser**：文档结构提取（章节、图片、表格）。
  - **Vector DB**：建立知识库，实现基于文档的 RAG 问答。
- **教学模式**：AI 基于文档内容生成任务，而不是基于通用知识。

### Phase 3: 多模态与富媒体 (中期规划)
- **场景**："像老师上课一样讲给我听。"
- **新增模块**：
  - **Media Engine**：
    - TTS (Text-to-Speech)：生成语音讲解。
    - Image Gen：为抽象概念生成图解。
  - **Lesson Player**：前端不再只是任务列表，而是类似 Coursera/Udemy 的播放器界面。
- **数据结构升级**：
  - `Task` 细化为 `LessonSteps` (Slide, Video, Quiz)。

### Phase 4: 全沉浸式教学 (远期愿景)
- **场景**："生成视频教程" / "虚拟助教面对面"。
- **技术储备**：
  - Video Generation (Sora/Runway API)。
  - Real-time Avatar (数字人)。
  - Voice Interaction (语音直接对话)。

## 3. 工程预留 (Future-Proofing)

为了支持上述演进，当前代码需遵循以下原则：

1.  **接口泛型化**：
    - 任务内容字段 (`contentJson`) 保持松散结构（JSON），以便未来存储音频 URL、视频链接等，无需改表结构。
2.  **模块解耦**：
    - `AIService` 应设计为插件式，方便随时接入 TTS 或 Vision 模型。
3.  **存储扩展**：
    - 预留对象存储（Object Storage）的接入位置，用于托管用户文件和生成媒体。

---
**记录时间**: 2026-02-13
**状态**: 规划中
