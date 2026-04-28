/**
 * Seed-скрипт: создаёт тестового пользователя с целью и несколькими записями.
 * Запуск: npm run db:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Тестовый пользователь
  const user = await prisma.user.upsert({
    where: { telegramId: 'test_user_001' },
    update: {},
    create: {
      telegramId: 'test_user_001',
      username: 'testuser',
      firstName: 'Тест',
    },
  });
  console.log(`✅ User: ${user.id}`);

  // Удаляем старые данные
  await prisma.goal.deleteMany({ where: { userId: user.id } });
  await prisma.userStats.deleteMany({ where: { userId: user.id } });

  // Цель
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: 'Купить Ferrari за 3 года',
      description: 'Хочу зарабатывать 1M+ в год через собственный бизнес',
      deadline: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
      subcategories: {
        create: [
          { name: 'Доход',   emoji: '💼', weight: 0.4,  color: '#10b981' },
          { name: 'Навыки',  emoji: '📚', weight: 0.25, color: '#6366f1' },
          { name: 'Нетворк', emoji: '🤝', weight: 0.2,  color: '#f59e0b' },
          { name: 'Здоровье',emoji: '💪', weight: 0.15, color: '#ef4444' },
        ],
      },
    },
    include: { subcategories: true },
  });
  console.log(`✅ Goal: "${goal.title}"`);

  // Записи за последние 7 дней
  const entries = [
    {
      daysAgo: 6,
      text: 'Провёл 2 созвона с потенциальными клиентами, прочитал главу книги по продажам',
      scores: [8, 5, 3, 0],
      total: 62,
      comment: 'Хороший день! Клиентские созвоны — прямой путь к доходу.',
    },
    {
      daysAgo: 5,
      text: 'Записался на курс по Python, сходил в зал на 1.5 часа',
      scores: [0, 7, 0, 9],
      total: 45,
      comment: 'Баланс навыков и здоровья. Можно было добавить бизнес-активность.',
    },
    {
      daysAgo: 4,
      text: 'Познакомился с предпринимателем на конференции, обменялись контактами, обсудили коллаборацию',
      scores: [3, 0, 10, 4],
      total: 48,
      comment: 'Отличный нетворкинг! Такие знакомства часто приводят к деньгам.',
    },
    {
      daysAgo: 3,
      text: 'Закрыл первую сделку на 50к, отметил с командой',
      scores: [10, 2, 5, 0],
      total: 78,
      comment: 'Звёздный день! Первая сделка — это огромный шаг к цели.',
    },
    {
      daysAgo: 2,
      text: 'Прошёл 2 модуля курса, сделал зарядку, написал пост в LinkedIn',
      scores: [2, 8, 6, 5],
      total: 58,
      comment: 'Разносторонний день. LinkedIn-пост может привлечь новые контакты.',
    },
    {
      daysAgo: 1,
      text: 'Встреча с инвестором, отказали но дали полезный фидбек, пробежал 5км',
      scores: [5, 4, 8, 7],
      total: 60,
      comment: 'Отказ — это тоже прогресс. Фидбек от инвестора бесценен.',
    },
    {
      daysAgo: 0,
      text: 'Запустил рекламную кампанию, провёл 3 демо-звонка, поработал с ментором',
      scores: [9, 6, 7, 0],
      total: 75,
      comment: 'Мощный день! Три демо-звонка — серьёзная воронка продаж.',
    },
  ];

  for (const e of entries) {
    const date = new Date();
    date.setDate(date.getDate() - e.daysAgo);
    const dateOnly = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        rawText: e.text,
        date: dateOnly,
        totalScore: e.total,
        aiComment: e.comment,
        entryScores: {
          create: goal.subcategories.map((sub, i) => ({
            subcategoryId: sub.id,
            score: e.scores[i] ?? 0,
            actions: [`Действие по ${sub.name}`],
            aiComment: `Оценка по ${sub.name}: ${e.scores[i]}`,
          })),
        },
      },
    });
  }
  console.log(`✅ Created ${entries.length} entries`);

  // Stats
  await prisma.userStats.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      currentStreak: 7,
      longestStreak: 7,
      totalScore: entries.reduce((s, e) => s + e.total, 0),
      totalEntries: entries.length,
      lastEntryDate: new Date(Date.UTC(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
      )),
      progressPercent: 38.2,
    },
  });
  console.log(`✅ Stats created (streak: 7, progress: 38.2%)`);

  console.log('\n🎉 Seed complete!');
  console.log(`\nДля тестирования используй:`);
  console.log(`POST /api/v1/auth/dev  body: { "username": "testuser" }`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
