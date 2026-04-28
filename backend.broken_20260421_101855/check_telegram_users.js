const axios = require('axios');

async function checkTelegramUsers() {
  const BOT_TOKEN = '8634119969:AAF-iKrzW6BpVddJfh-liSvwPzZeQdAez8k';
  
  try {
    console.log('🤖 ЗАПРОС ИНФОРМАЦИИ О БОТЕ ЧЕРЕЗ TELEGRAM API');
    console.log('=============================================');
    
    // Получаем информацию о боте
    const botInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    console.log('✅ Бот:', botInfo.data.result.username);
    console.log('   ID:', botInfo.data.result.id);
    console.log('   Имя:', botInfo.data.result.first_name);
    
    // Пытаемся получить количество подписчиков (это ограниченно API)
    console.log('\n📊 Информация о подписчиках:');
    console.log('ℹ️  Telegram API не предоставляет список всех пользователей бота');
    console.log('ℹ️  Можно получить только информацию при взаимодействии');
    
    // Проверяем есть ли вебхук
    const webhookInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    console.log('\n🌐 Вебхук:', webhookInfo.data.result.url || 'Не настроен');
    console.log('   Ожидающих обновлений:', webhookInfo.data.result.pending_update_count);
    
    // Получаем последние обновления (если есть)
    const updates = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=5`);
    console.log('\n🔄 Последние обновления:', updates.data.result.length);
    
    if (updates.data.result.length > 0) {
      updates.data.result.forEach((update, i) => {
        const user = update.message?.from || update.callback_query?.from;
        if (user) {
          console.log(`\n${i + 1}. Пользователь: ${user.first_name} ${user.last_name || ''}`);
          console.log(`   ID: ${user.id}, username: @${user.username || 'нет'}`);
          console.log(`   Дата: ${new Date(update.message?.date * 1000).toISOString()}`);
          if (update.message?.text) {
            console.log(`   Сообщение: ${update.message.text.substring(0, 50)}...`);
          }
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка Telegram API:', error.response?.data || error.message);
  }
}

checkTelegramUsers();
