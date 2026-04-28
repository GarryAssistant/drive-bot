import OpenAI from 'openai';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Схемы ответов ──────────────────────────────────────────────────────────

const DecomposedTasksSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      estimatedDays: z.number().min(0.5).max(90),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      order: z.number(),
    })
  ),
  projectDescription: z.string(),
});

const SuggestionSchema = z.object({
  suggestion: z.string(),
  reason: z.string(),
});

type DecomposedTask = z.infer<typeof DecomposedTasksSchema>['tasks'][0];
export type DecomposeResult = z.infer<typeof DecomposedTasksSchema>;

// ─── Groq Client ────────────────────────────────────────────────────────────

function getClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

// ─── AI: Декомпозиция цели ──────────────────────────────────────────────────

export async function decomposeGoal(
  userId: string,
  goalTitle: string,
  context?: {
    deadline?: string;
    priority?: string;
    additionalContext?: string;
  }
): Promise<DecomposeResult> {
  const client = getClient();

  // Get user's learning history for personalization
  const learningHistory = await prisma.aILearning.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { input: true, output: true, rating: true },
  });

  const learningStr = learningHistory.length > 0
    ? '\n\nИстория предыдущих декомпозиций пользователя (чему я научился):\n' +
      learningHistory.map((l) => `- Ввод: "${l.input}" → Вывод: "${l.output.slice(0, 200)}" (рейтинг: ${l.rating || 'не оценено'})`).join('\n')
    : '';

  const contextStr = context
    ? `\n\nКонтекст:\n${context.deadline ? `Дедлайн: ${context.deadline}` : ''}\n${context.priority ? `Приоритет: ${context.priority}` : ''}\n${context.additionalContext ? `Доп. инфо: ${context.additionalContext}` : ''}`
    : '';

  if (!client) {
    // Mock response
    const mockTasks: DecomposedTask[] = [
      { title: `Исследовать "${goalTitle}"`, description: 'Провести анализ и собрать информацию', estimatedDays: 2, priority: 'high', order: 1 },
      { title: `Спланировать "${goalTitle}"`, description: 'Составить детальный план реализации', estimatedDays: 1, priority: 'high', order: 2 },
      { title: `Реализовать "${goalTitle}"`, description: 'Приступить к основной работе', estimatedDays: 5, priority: 'medium', order: 3 },
      { title: 'Протестировать результат', description: 'Проверить качество и внести правки', estimatedDays: 2, priority: 'medium', order: 4 },
      { title: 'Завершить и подвести итоги', description: 'Финализировать и оценить результат', estimatedDays: 1, priority: 'low', order: 5 },
    ];
    return { tasks: mockTasks, projectDescription: 'Проект по достижению цели' };
  }

  const prompt = `Ты AI-коуч по продуктивности. Помоги пользователю декомпозировать большую цель на конкретные задачи.

Цель: "${goalTitle}"${contextStr}${learningStr}

Задачи должны быть:
1. Конкретными и измеримыми
2. Реалистичными по времени
3. Расставленными по приоритету
4. В логической последовательности

Верни JSON:
{
  "tasks": [
    {
      "title": "Название задачи (с глаголом в инфинитиве)",
      "description": "Краткое описание, ЧТО конкретно нужно сделать",
      "estimatedDays": число (дней на выполнение, от 0.5 до 90),
      "priority": "low" | "medium" | "high" | "urgent",
      "order": число (порядковый номер)
    }
  ],
  "projectDescription": "Краткое описание проекта 1-2 предложения"
}

Важно:
- 3-8 задач, оптимально 5-6
- Учитывай историю обучения пользователя (если есть)
- Дедлайн влияет на количество и срочность задач
- Высокоприоритетных задач не более 2
Верни ТОЛЬКО валидный JSON.`;

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 1000,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), 30000)
      ),
    ]);

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    const result = DecomposedTasksSchema.parse(JSON.parse(content));

    // Save to learning history
    await prisma.aILearning.create({
      data: {
        userId,
        input: goalTitle,
        output: JSON.stringify(result),
        context: context ? { deadline: context.deadline, priority: context.priority } : {},
      },
    }).catch(() => {});

    return result;
  } catch (error: any) {
    console.error('AI decompose error:', error.message);
    throw new Error('Не удалось декомпозировать цель. Попробуй ещё раз.');
  }
}

// ─── AI: Следующая задача ───────────────────────────────────────────────────

export async function suggestNextTask(
  userId: string,
  projectId: string
): Promise<{ suggestion: string; reason: string } | null> {
  const client = getClient();

  if (!client) {
    return {
      suggestion: 'Продолжай работать над текущей задачей',
      reason: 'Каждая минута работы приближает к цели',
    };
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      status: { in: ['todo', 'in_progress'] },
    },
    orderBy: [{ priority: 'desc' }, { sortOrder: 'asc' }],
    take: 10,
  });

  if (tasks.length === 0) return null;

  const tasksStr = tasks.map((t) =>
    `- ${t.status === 'in_progress' ? '[В РАБОТЕ]' : '[ОЖИДАЕТ]'} ${t.title} (приоритет: ${t.priority}, оценка: ${t.estimatedTime || '?'} мин)`
  ).join('\n');

  const prompt = `На основе списка задач подскажи, что делать дальше. Учти, что задачи "в работе" приоритетны.

Задачи проекта:
${tasksStr}

Верни JSON:
{
  "suggestion": "Конкретная рекомендация, что делать",
  "reason": "Почему именно эта задача"
}

Верни ТОЛЬКО валидный JSON.`;

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 300,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), 15000)
      ),
    ]);

    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return SuggestionSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

// ─── AI: Check-in reminder ──────────────────────────────────────────────────

export async function generateTaskCheckin(taskTitle: string, status: string, priority: string): Promise<string> {
  const client = getClient();

  const messages = [
    `Как продвигается задача "${taskTitle}"? Есть ли блокеры? Нужна помощь?`,
    `⏰ Напоминаю про задачу "${taskTitle}". Как успехи?`,
    `Что по задаче "${taskTitle}"? Всё идёт по плану?`,
    `Не забывай про "${taskTitle}"! Сделай хотя бы маленький шаг.`,
    `Проверка: как дела с "${taskTitle}"? Может нужно пересмотреть приоритеты?`,
  ];

  if (!client) {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  const prompt = `Напиши короткое (1 предложение) дружеское напоминание пользователю о задаче "${taskTitle}" (статус: ${status}, приоритет: ${priority}). Без форматирования. Не используй markdown.`;

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 100,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), 10000)
      ),
    ]);

    return response.choices[0]?.message?.content?.trim() || messages[0];
  } catch {
    return messages[Math.floor(Math.random() * messages.length)];
  }
}

// ─── Rate & Learn ────────────────────────────────────────────────────────────

export async function rateAIDecomposition(userId: string, rating: number) {
  const last = await prisma.aILearning.findFirst({
    where: { userId, rating: null },
    orderBy: { createdAt: 'desc' },
  });
  if (last) {
    await prisma.aILearning.update({
      where: { id: last.id },
      data: { rating },
    });
  }
}
