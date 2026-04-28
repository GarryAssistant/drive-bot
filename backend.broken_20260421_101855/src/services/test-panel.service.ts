import { Context, Markup } from 'telegraf';
import { analyzeEntry } from './ai.service';
import { BADGES, formatBadgeMessage } from './badge.service';
import { prisma } from './prisma.service';

// ─── Personas ─────────────────────────────────────────────────────────────────
export const PERSONAS: Record<string, {
  name: string; age: number; emoji: string;
  goalTitle: string; goalType: string;
  subcategories: string[];
  bio: string;
  sampleEntries: string[];
}> = {
  sasha: {
    name: 'Саша', age: 24, emoji: '👨‍💻',
    goalTitle: 'Купить BMW 3 серии',
    goalType: 'Машина',
    subcategories: ['Доход', 'Накопления', 'Навыки', 'Нетворк'],
    bio: 'Программист в аутсорсе, зарплата 120к. Живёт с родителями, расходы низкие.',
    sampleEntries: [
      'Сегодня закрыл таск, получил премию 15к. Вечером смотрел курс по React. С другом обсудили идею пет-проекта.',
      'Ничего не делал по цели. Играл в игры весь день. Немного поработал вечером.',
      'Сделал фриланс проект за 20к, сразу отложил 15к на накопления. Посмотрел обзор BMW.',
    ],
  },
  max: {
    name: 'Макс', age: 29, emoji: '👨‍🏭',
    goalTitle: 'Запустить барбершоп',
    goalType: 'Бизнес',
    subcategories: ['Деньги', 'Нетворк', 'Знания', 'Действия'],
    bio: 'Работает мастером в чужом барбершопе 5 лет. Хочет своё. Копит и учится.',
    sampleEntries: [
      'Поговорил с арендодателем, смотрел помещение на Ленина. Дорого но интересно. Посчитал бизнес план.',
      'Зарегистрировал ИП наконец-то. Открыл расчётный счёт. Устал но доволен.',
      'Снова отложил в сторону, не было сил после работы. Вечером смотрел сериал.',
    ],
  },
  dima: {
    name: 'Дима', age: 22, emoji: '👨‍🎓',
    goalTitle: 'Купить первую машину (Hyundai Solaris)',
    goalType: 'Машина',
    subcategories: ['Подработки', 'Экономия', 'Работа', 'Обучение'],
    bio: 'Студент 4-го курса, подрабатывает курьером. Цель — машина через 1.5 года.',
    sampleEntries: [
      'Отработал смену курьером, заработал 2800. Не тратил на кофе и кафе, сэкономил 500р. Сдал лабу.',
      'Нашёл подработку SMM за 15к в месяц. Начинаю в понедельник. Погуглил страховку на авто.',
      'Потратил лишнего на концерт, жалею. Зато познакомился с чуваком у которого свой бизнес.',
    ],
  },
  anton: {
    name: 'Антон', age: 33, emoji: '💼',
    goalTitle: 'Первый взнос на квартиру в Москве',
    goalType: 'Квартира',
    subcategories: ['Доход', 'Инвестиции', 'Экономия', 'Карьера'],
    bio: 'Менеджер среднего звена, зарплата 180к. Жена, ребёнок. Цель — 2.5 млн за 2 года.',
    sampleEntries: [
      'Перевёл 30к на ИИС. Провёл переговоры по новому контракту, могут поднять зарплату на 20%. Поужинали дома вместо ресторана.',
      'Ничего финансового. Занимался с ребёнком, это тоже важно.',
      'Получил квартальную премию 80к. Сразу 60к в накопления. Посмотрел ипотечные программы.',
    ],
  },
};

// ─── Test command handler ─────────────────────────────────────────────────────
export async function handleTestCommand(ctx: Context, adminIds: string[]): Promise<void> {
  const tgId = String(ctx.from!.id);
  if (!adminIds.includes(tgId)) {
    await ctx.reply('❌ Только для администраторов');
    return;
  }

  const text = (ctx.message as any)?.text ?? '';
  const parts = text.replace('/test', '').trim().split(' ');
  const subCmd = parts[0]?.toLowerCase();

  // /test — show menu
  if (!subCmd) {
    await ctx.reply(
      `🧪 *Test Panel*\n\n` +
      `Команды:\n` +
      `• \`/test entry <текст>\` — AI анализ текста (без сохранения)\n` +
      `• \`/test persona\` — выбрать персону для тестов\n` +
      `• \`/test notify <тип>\` — превью уведомления\n` +
      `• \`/test badge <тип>\` — превью бейджа\n` +
      `• \`/test ai <текст>\` — сырой AI ответ по текущей персоне\n\n` +
      `Типы notify: \`reminder\` \`warmup1\`...\`warmup7\` \`streak\` \`weekly\`\n` +
      `Типы badge: ${Object.keys(BADGES).join(', ')}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /test persona — show persona selector
  if (subCmd === 'persona') {
    const buttons = Object.entries(PERSONAS).map(([key, p]) =>
      [Markup.button.callback(`${p.emoji} ${p.name}, ${p.age} — ${p.goalType}`, `test_persona_${key}`)]
    );
    buttons.push([Markup.button.callback('👤 Я сам (свой аккаунт)', 'test_persona_self')]);
    await ctx.reply(
      '🎭 *Выбери персону для тестирования:*\n\nБот будет отвечать от имени этой персоны',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
    return;
  }

  // /test notify <type>
  if (subCmd === 'notify') {
    const notifyType = parts[1] ?? 'reminder';
    await sendTestNotification(ctx, notifyType);
    return;
  }

  // /test badge <type>
  if (subCmd === 'badge') {
    const badgeType = parts[1] ?? 'streak_7';
    const b = BADGES[badgeType];
    if (!b) {
      await ctx.reply(`❌ Неизвестный бейдж. Доступные: ${Object.keys(BADGES).join(', ')}`);
      return;
    }
    await ctx.reply(
      `Превью бейджа:\n${formatBadgeMessage(badgeType)}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /test entry <text> or /test ai <text>
  if (subCmd === 'entry' || subCmd === 'ai') {
    const entryText = parts.slice(1).join(' ');
    if (!entryText || entryText.length < 5) {
      await ctx.reply('Укажи текст: `/test entry Сегодня поработал 4 часа, отложил 5к`', { parse_mode: 'Markdown' });
      return;
    }

    // Get current persona from DB (stored in user session)
    const user = await prisma.user.findUnique({
      where: { telegramId: tgId },
      select: { sessionData: true },
    });
    const sess = user?.sessionData as any;
    const personaKey = sess?.testPersona as string | undefined;
    const persona = personaKey ? PERSONAS[personaKey] : null;

    const goalTitle = persona?.goalTitle ?? 'Достичь финансовой цели';
    const subcats = persona?.subcategories ?? ['Доход', 'Накопления', 'Навыки', 'Действия'];

    await ctx.reply(
      persona
        ? `🎭 Анализирую от имени: *${persona.emoji} ${persona.name}, ${persona.age}*\n📌 Цель: ${persona.goalTitle}\n\n🤖 Запрос к AI...`
        : `🤖 Анализирую (без персоны)...`,
      { parse_mode: 'Markdown' }
    );

    try {
      const analysis = await analyzeEntry(entryText, goalTitle, subcats);
      const scoreEmoji = analysis.totalScore >= 70 ? '🟢' : analysis.totalScore >= 40 ? '🟡' : '🔴';

      let reply = `${scoreEmoji} *Оценка: ${analysis.totalScore}/100*\n\n`;
      reply += `💬 ${analysis.overallComment}\n\n*По категориям:*\n`;
      for (const s of analysis.subcategories) {
        reply += `• ${s.name}: *${s.score}/10*\n  _${s.comment}_\n`;
      }
      if (analysis.strengths.length) {
        reply += `\n✅ *Сильные стороны:*\n${analysis.strengths.map(s => `• ${s}`).join('\n')}`;
      }
      if (analysis.suggestions.length) {
        reply += `\n\n💡 *Рекомендации:*\n${analysis.suggestions.map(s => `• ${s}`).join('\n')}`;
      }
      reply += `\n\n_⚠️ Тест-режим: в БД не сохранено_`;

      await ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (e: any) {
      await ctx.reply(`❌ Ошибка AI: ${e.message}`);
    }
    return;
  }

  await ctx.reply('Неизвестная команда. Напиши `/test` для справки.', { parse_mode: 'Markdown' });
}

// ─── Persona callback handler ─────────────────────────────────────────────────
export async function handlePersonaCallback(ctx: Context, personaKey: string): Promise<void> {
  await ctx.answerCbQuery();

  if (personaKey === 'self') {
    // Clear persona
    await prisma.user.updateMany({
      where: { telegramId: String(ctx.from!.id) },
      data: { sessionData: { testPersona: null } as any },
    });
    await ctx.reply('✅ Режим персоны сброшен — работаешь от своего аккаунта');
    return;
  }

  const persona = PERSONAS[personaKey];
  if (!persona) { await ctx.reply('❌ Персона не найдена'); return; }

  // Save persona to session
  const user = await prisma.user.findUnique({ where: { telegramId: String(ctx.from!.id) }, select: { sessionData: true } });
  const sess = (user?.sessionData as any) ?? {};
  await prisma.user.updateMany({
    where: { telegramId: String(ctx.from!.id) },
    data: { sessionData: { ...sess, testPersona: personaKey } as any },
  });

  const p = persona;
  await ctx.reply(
    `🎭 *Персона активирована: ${p.emoji} ${p.name}, ${p.age} лет*\n\n` +
    `📌 Цель: ${p.goalTitle}\n` +
    `👤 ${p.bio}\n\n` +
    `*Категории:* ${p.subcategories.join(', ')}\n\n` +
    `*Примеры записей для теста:*\n` +
    p.sampleEntries.map((e, i) => `${i + 1}. _${e}_`).join('\n') +
    `\n\n💡 Используй: \`/test entry <текст>\`\nИли скопируй один из примеров выше`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Notification previews ────────────────────────────────────────────────────
async function sendTestNotification(ctx: Context, type: string): Promise<void> {
  const previewHeader = '🔔 *Превью уведомления:*\n\n';
  const name = ctx.from!.first_name ?? 'Саша';

  const notifications: Record<string, string> = {
    reminder: `Привет, ${name}! Как прошёл твой день? 🔥 Стрик: 7 дней\n\n📌 Цель: <b>Купить BMW 3 серии</b>\n\nНапиши, что сделал сегодня — это займёт 1 минуту 💪\n/entry`,
    streak: `⚠️ ${name}, стрик 7 дней под угрозой!\n\nЗапиши день за 2 минуты и сохрани серию 🔥\n/entry`,
    weekly: `📊 <b>Итоги недели, ${name}!</b>\n\n📌 Цель: <b>Купить BMW 3 серии</b>\n📈 Прогресс: <b>23%</b>\n🔥 Стрик: <b>7 дней</b>\n📝 Всего записей: <b>7</b>\n\nПосмотреть AI-анализ недели: /week`,
    warmup1: `${name}, 👋 Привет! Рад что ты здесь.\n\nBольшие цели начинаются с первого шага. У тебя есть идея чего хочешь достичь — машина, квартира, бизнес?\n\n🎯 Поставь цель: /goal`,
    warmup2: `${name}, 💡 Знаешь, в чём секрет людей которые достигают большего?\n\nОни не мотивированы каждый день. Они просто <b>записывают</b> что сделали. Маленький трекинг → большие результаты.\n\n🎯 Начни сегодня: /goal`,
    warmup3: `${name}, 🚗 Представь: через год ты садишься в машину мечты. Или заходишь в свою квартиру. Или запускаешь бизнес.\n\nЭто начинается сейчас, с одного решения.\n\n🎯 Поставь цель: /goal`,
    warmup7: `${name}, ⏰ Неделя прошла. Ты ещё не поставил цель.\n\nЭто нормально — многие откладывают. Но каждый день промедления это минус один день к мечте.\n\n🎯 2 минуты чтобы начать: /goal`,
  };

  const text = notifications[type];
  if (!text) {
    await ctx.reply(`❌ Неизвестный тип. Доступные: ${Object.keys(notifications).join(', ')}`);
    return;
  }

  await ctx.reply(previewHeader + `\`${type}\``, { parse_mode: 'Markdown' });
  await ctx.reply(text, { parse_mode: 'HTML' });
}
