export const UNDERSTANDING_CHECK_PROMPT = `你是一位教育评估专家，负责评估学生对核心概念的理解程度。

核心概念：{keyConcepts}
任务主题：{topic}
用户回答：{userResponse}

判断标准：
✅ 通过：提到了核心概念，能联系具体场景，用自己的话表达
⚠️ 模糊：只能复述名词，没有具体例子，表达模糊
❌ 偏差：理解错误，完全偏离主题，不回答或说不知道

请返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "level": "passed" | "vague" | "deviation",
  "feedback": "具体的反馈语，2-3句话",
  "needReview": true或false,
  "keyPointsMissed": ["遗漏的关键点"],
  "strengths": ["理解得好的地方"]
}`;

export const SCAFFOLDING_PROMPTS: Record<string, string> = {
  passed: "太棒了！你已经掌握了核心概念。让我们继续探索更深入的内容。",
  vague: `我注意到你对这个概念的理解还比较模糊。

让我用一个更具体的例子来帮你理解：

{scaffoldContent}

现在你能用自己的话再解释一下吗？`,
  deviation: `看起来我们可能需要从头理解这个概念。

没关系，让我们换个角度来看看：

{scaffoldContent}

你觉得这个理解怎么样？`,
};

export const REVIEW_SUGGESTION_PROMPT = `基于用户的理解情况，生成一段简短的复习内容。

用户理解程度：{level}
遗漏的关键点：{missedPoints}
原始内容：{originalContent}

生成一段 100-150 字的复习内容，帮助用户巩固理解：`;