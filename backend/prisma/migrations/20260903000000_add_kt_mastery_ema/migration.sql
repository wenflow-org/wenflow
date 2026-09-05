-- θ−d 知识状态 EMA：ktEstimate 的跨会话滑动平均（α=0.2），替代每轮 LLM 独立估计
ALTER TABLE "memory_traces" ADD COLUMN "ktMasteryEma" REAL;