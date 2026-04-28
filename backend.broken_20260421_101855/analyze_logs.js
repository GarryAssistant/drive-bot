const fs = require('fs');
const path = require('path');

async function analyzeLogs() {
  try {
    const logFile = path.join(__dirname, 'bot.log');
    
    if (!fs.existsSync(logFile)) {
      console.log('❌ Файл bot.log не найден');
      return;
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n');
    
    console.log('📊 АНАЛИЗ ЛОГОВ БОТА');
    console.log('==================');
    console.log(`Всего строк: ${lines.length}`);
    
    // Ищем упоминания пользователей
    const userPatterns = [
      /telegramId: (\d+)/i,
      /user_id: (\d+)/i,
      /from: (\d+)/i,
      /userId: "([^"]+)"/i,
      /(\d{9,})/, // Telegram ID обычно 9+ цифр
    ];
    
    const foundUsers = new Set();
    
    lines.forEach(line => {
      userPatterns.forEach(pattern => {
        const match = line.match(pattern);
        if (match && match[1]) {
          foundUsers.add(match[1]);
        }
      });
    });
    
    console.log(`\n👥 Найдено уникальных ID: ${foundUsers.size}`);
    if (foundUsers.size > 0) {
      console.log('Список ID:');
      Array.from(foundUsers).forEach(id => console.log(`  - ${id}`));
    }
    
    // Ищем команды
    const commands = lines.filter(line => 
      line.includes('/start') || 
      line.includes('/goal') || 
      line.includes('/entry') ||
      line.includes('/progress')
    );
    
    console.log(`\n📝 Найдено команд: ${commands.length}`);
    if (commands.length > 0) {
      console.log('Последние 5 команд:');
      commands.slice(-5).forEach(cmd => console.log(`  - ${cmd.substring(0, 100)}...`));
    }
    
    // Ищем ошибки
    const errors = lines.filter(line => 
      line.includes('ERROR') || 
      line.includes('error') || 
      line.includes('Error') ||
      line.includes('❌')
    );
    
    console.log(`\n🚨 Найдено ошибок: ${errors.length}`);
    if (errors.length > 0) {
      console.log('Последние 5 ошибок:');
      errors.slice(-5).forEach(err => console.log(`  - ${err.substring(0, 100)}...`));
    }
    
    // Временной диапазон
    const timestamps = lines
      .map(line => line.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/))
      .filter(match => match)
      .map(match => match[0]);
    
    if (timestamps.length >= 2) {
      console.log(`\n⏰ Временной диапазон: ${timestamps[0]} - ${timestamps[timestamps.length - 1]}`);
    }
    
  } catch (error) {
    console.error('Ошибка анализа логов:', error);
  }
}

analyzeLogs();
