import { Context } from 'telegraf';
import { prisma } from './prisma.service';

export async function handleExport(ctx: Context): Promise<void> {
  const tgId = String(ctx.from!.id);
  const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
  if (!user) { await ctx.reply('Сначала зарегистрируйся: /start'); return; }

  const goal = await prisma.goal.findFirst({
    where: { userId: user.id, isActive: true },
    include: { subcategories: true },
  });
  if (!goal) { await ctx.reply('Нет активной цели. Создай через /goal'); return; }

  const entries = await prisma.entry.findMany({
    where: { userId: user.id, goalId: goal.id },
    include: { entryScores: { include: { subcategory: true } } },
    orderBy: { date: 'asc' },
  });

  if (entries.length === 0) { await ctx.reply('Нет записей для экспорта. Добавь первую через /entry'); return; }

  // Build CSV
  const subcatNames = goal.subcategories.map(s => s.name);
  const header = ['Дата', 'Общий балл', 'Комментарий AI', ...subcatNames, 'Текст записи'].join(';');
  const rows = entries.map(e => {
    const dateStr = e.date.toLocaleDateString('ru-RU');
    const comment = (e.aiComment ?? '').replace(/;/g, ',').replace(/\n/g, ' ');
    const text = e.rawText.replace(/;/g, ',').replace(/\n/g, ' ').slice(0, 500);
    const scores = subcatNames.map(name => {
      const s = e.entryScores.find(sc => sc.subcategory.name === name);
      return s ? s.score.toFixed(0) : '';
    });
    return [dateStr, e.totalScore.toFixed(0), `"${comment}"`, ...scores, `"${text}"`].join(';');
  });

  const csv = [header, ...rows].join('\n');
  const buf = Buffer.from('\uFEFF' + csv, 'utf8'); // BOM for Excel

  const filename = `drive_export_${new Date().toISOString().slice(0, 10)}.csv`;

  await ctx.replyWithDocument(
    { source: buf, filename },
    { caption: `📤 Экспорт: ${entries.length} записей по цели *${goal.title}*`, parse_mode: 'Markdown' }
  );
}
