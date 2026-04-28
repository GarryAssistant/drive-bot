const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBotUsers() {
  try {
    console.log('🔍 ПРОВЕРКА ПОЛЬЗОВАТЕЛЕЙ В БАЗЕ ДАННЫХ');
    console.log('======================================');
    
    // Проверяем подключение
    const dbCheck = await prisma.$queryRaw`SELECT 1 as ok`;
    console.log('✅ База данных подключена');
    
    // Все пользователи
    const users = await prisma.user.findMany({
      include: {
        goals: true,
        entries: true,
        userStats: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`\n👥 Всего пользователей: ${users.length}`);
    
    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.username || 'Без имени'} (ID: ${user.telegramId})`);
      console.log(`   📅 Создан: ${user.createdAt.toISOString().split('T')[0]}`);
      console.log(`   🎯 Целей: ${user.goals.length}`);
      console.log(`   📝 Записей: ${user.entries.length}`);
      console.log(`   📊 Статистика: ${user.userStats ? 'Есть' : 'Нет'}`);
      
      if (user.goals.length > 0) {
        user.goals.forEach(goal => {
          console.log(`   🎯 Цель: "${goal.title}" (${goal.isActive ? 'Активна' : 'Неактивна'})`);
        });
      }
    });
    
    // Статистика по всей базе
    console.log('\n📊 ОБЩАЯ СТАТИСТИКА БАЗЫ:');
    
    const totalGoals = await prisma.goal.count();
    const totalEntries = await prisma.entry.count();
    const totalUserStats = await prisma.userStats.count();
    
    console.log(`   🎯 Всего целей: ${totalGoals}`);
    console.log(`   📝 Всего записей: ${totalEntries}`);
    console.log(`   📊 Всего статистик: ${totalUserStats}`);
    
    // Проверяем есть ли данные кроме тестовых
    const realUsers = users.filter(u => u.telegramId !== 'test_user_001');
    console.log(`\n👤 Реальных пользователей (не тестовых): ${realUsers.length}`);
    
    if (realUsers.length === 0) {
      console.log('⚠️  В базе только тестовые данные!');
      console.log('ℹ️  Похоже реальные данные были потеряны при использовании db push --accept-data-loss');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkBotUsers();
