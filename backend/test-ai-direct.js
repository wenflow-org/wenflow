// 测试 AI 服务
require('dotenv').config();

const { getOpenAIClient } = require('./src/gateway/openai-client');

async function testAI() {
  try {
    console.log('Testing AI service...');
    console.log('API URL:', process.env.AI_API_URL);
    console.log('API Key:', process.env.AI_API_KEY ? process.env.AI_API_KEY.substring(0, 10) + '...' : 'undefined');
    console.log('Model:', process.env.AI_MODEL);
    
    const client = getOpenAIClient();
    
    const messages = [
      {
        role: 'system',
        content: '你是一个有帮助的助手。'
      },
      {
        role: 'user',
        content: '你好，测试消息'
      }
    ];
    
    console.log('\nSending messages:', JSON.stringify(messages, null, 2));
    
    const response = await client.chatCompletion({
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000,
    });
    
    console.log('\nResponse:', JSON.stringify(response, null, 2));
    console.log('\nContent:', response.choices[0]?.message?.content);
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testAI();
