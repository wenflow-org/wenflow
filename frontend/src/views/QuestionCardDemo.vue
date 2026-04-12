<template>
  <div class="question-card-demo">
    <h1>QuestionCard 组件演示</h1>
    <p class="description">展示 4 种不同的问题 UI 类型</p>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- 选择题 -->
      <el-tab-pane label="选择题" name="choice">
        <div class="demo-container">
          <QuestionCard
            ui-type="choice"
            question="在 Python 中，以下哪个关键字用于定义函数？"
            :options="['def', 'function', 'func', 'define']"
            @submit="handleSubmit"
          />
        </div>
      </el-tab-pane>

      <!-- 输入题 -->
      <el-tab-pane label="思考题" name="input">
        <div class="demo-container">
          <QuestionCard
            ui-type="input"
            question="请解释什么是变量，以及它在编程中的作用是什么？"
            input-hint="从变量的定义、用途和重要性三个方面来思考"
            @submit="handleSubmit"
          />
        </div>
      </el-tab-pane>

      <!-- 代码题 -->
      <el-tab-pane label="编程题" name="code">
        <div class="demo-container">
          <QuestionCard
            ui-type="code"
            question="请编写一个 Python 函数，计算两个数的和并返回结果。"
            code-language="python"
            @submit="handleSubmit"
          />
        </div>
      </el-tab-pane>

      <!-- 反思题 -->
      <el-tab-pane label="反思题" name="reflection">
        <div class="demo-container">
          <QuestionCard
            ui-type="reflection"
            question="回顾今天的学习内容，你觉得哪个概念最难理解？你打算如何克服这个困难？"
            input-hint="思考：1）具体是哪个概念 2）为什么觉得难 3）可以采取哪些学习方法"
            @submit="handleSubmit"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 提交结果展示 -->
    <div v-if="lastSubmission" class="result-card">
      <h3>提交结果：</h3>
      <pre>{{ lastSubmission }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import QuestionCard from '@/components/QuestionCard.vue';

const activeTab = ref('choice');
const lastSubmission = ref<string>('');

const handleSubmit = (response: string) => {
  lastSubmission.value = response;
  console.log('提交回答:', response);
  
  // 显示成功提示
  alert('提交成功！\n\n你的回答：\n' + response);
};
</script>

<style scoped>
.question-card-demo {
  max-width: 900px;
  margin: 0 auto;
  padding: 40px 20px;
}

h1 {
  text-align: center;
  color: #303133;
  margin-bottom: 10px;
}

.description {
  text-align: center;
  color: #909399;
  margin-bottom: 30px;
}

.demo-container {
  padding: 20px;
  background-color: #f5f7fa;
  border-radius: 8px;
  min-height: 400px;
}

.result-card {
  margin-top: 30px;
  padding: 20px;
  background-color: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 8px;
}

.result-card h3 {
  margin-top: 0;
  color: #67c23a;
}

.result-card pre {
  background-color: #ffffff;
  padding: 15px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 300px;
  overflow-y: auto;
}
</style>