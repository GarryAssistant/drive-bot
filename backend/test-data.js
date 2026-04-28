const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testData() {
  try {
    console.log('🔍 Проверка данных в базе...');
    
    // Пользователь
    const user = await prisma.user.findUnique({
      where: { telegramId: '422445856' },
      include: {
        goals: true,
        entries: true,
        userStats: true
      }
    });
    
    console.log('👤 Пользователь:', user?.username, 'ID:', user?.id);
    console.log('🎯 Цели:', user?.goals?.length || 0);
    console.log('📝 Записи:', user?.entries?.length || 0);
    console.log('📊 Статистика:', user?.userStats ? 'Есть' : 'Нет');
    
    if (user?.goals?.length > 0) {
      const goal = user.goals[0];
      console.log('\n🎯 Первая цель:', goal.title);
      
      const entries = await prisma.entry.findMany({
        where: { goalId: goal.id },
        orderBy: { date: 'desc' },
        take: 5
      });
      
      console.log('📅 Последние записи:');
      entries.forEach(e => {
        console.log(`  ${e.date}: ${e.rawText.substring(0, 50)}...`);
      });
    }
    
    console.log('\n✅ Данные восстановлены успешно!');
  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testData();
