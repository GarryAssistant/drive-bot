import OpenAI from 'openai';
import { z } from 'zod';

// ─── Схемы ответов от AI ───────────────────────────────────────────────────

const SubcategorySchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(10),
  actions: z.array(z.string()),
  comment: z.string(),
});

const AnalysisResultSchema = z.object({
  subcategories: z.array(SubcategorySchema),
  totalScore: z.number().min(0).max(100),
  overallComment: z.string(),
  strengths: z.array(z.string()),
  suggestions: z.array(z.string()),
});

const SuggestedSubcategoriesSchema = z.object({
  subcategories: z.array(
    z.object({
      name: z.string(),
      emoji: z.string(),
      weight: z.number().min(0.1).max(1.0),
      color: z.string(),
      description: z.string(),
    })
  ),
});

const WeeklyReportSchema = z.object({
  summary: z.string(),
  topCategory: z.string(),
  weakCategory: z.string(),
  trend: z.enum(['improving', 'declining', 'stable']),
  insights: z.array(z.string()),
  nextWeekFocus: z.string(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type SuggestedSubcategory = z.infer<typeof SuggestedSubcategoriesSchema>['subcategories'][0];
export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;

// ─── Клиент Groq (OpenAI-compatible) ───────────────────────────────────────

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

// ─── Моковые ответы (пока нет OpenAI ключа) ───────────────────────────────

function getMockAnalysis(
  subcategoryNames: string[],
  rawText: string
): AnalysisResult {
  const subcategories = subcategoryNames.map((name, i) => {
    const scores = [8, 6, 4, 7, 5];
    const score = scores[i % scores.length];
    return {
      name,
      score,
      actions: [`Действие из текста, связанное с "${name}"`],
      comment: `Хорошая активность в категории ${name}.`,
    };
  });

  const totalScore = Math.round(
    subcategories.reduce((sum, s) => sum + s.score, 0) /
      subcategories.length *
      10
  );

  return {
    subcategories,
    totalScore,
    overallComment:
      'Продуктивный день! Ты делаешь конкретные шаги к цели. Продолжай в том же темпе.',
    strengths: ['Системный подход', 'Разнообразие действий'],
    suggestions: [
      'Попробуй добавить больше действий по нетворку',
      'Запланируй конкретную задачу на завтра',
    ],
  };
}

function getMockSubcategories(goalTitle: string): SuggestedSubcategory[] {
  return [
    {
      name: 'Доход',
      emoji: '💼',
      weight: 0.4,
      color: '#10b981',
      description: 'Действия, напрямую влияющие на заработок',
    },
    {
      name: 'Навыки',
      emoji: '📚',
      weight: 0.25,
      color: '#6366f1',
      description: 'Обучение, практика, развитие компетенций',
    },
    {
      name: 'Нетворк',
      emoji: '🤝',
      weight: 0.2,
      color: '#f59e0b',
      description: 'Знакомства, партнёрства, связи',
    },
    {
      name: 'Здоровье',
      emoji: '💪',
      weight: 0.15,
      color: '#ef4444',
      description: 'Физическое и ментальное здоровье',
    },
  ];
}

function getMockWeeklyReport(): WeeklyReport {
  return {
    summary:
      'Хорошая неделя — ты был активен в 5 из 7 дней. Основной прогресс по доходу и навыкам.',
    topCategory: 'Доход',
    weakCategory: 'Нетворк',
    trend: 'improving',
    insights: [
      'Ты наиболее продуктивен во вторник и четверг',
      'Нетворк-действий было мало — всего 2 за неделю',
      'Активность выросла по сравнению с прошлой неделей на 20%',
    ],
    nextWeekFocus:
      'Сфокусируйся на нетворке: запланируй 3 конкретных знакомства или встречи.',
  };
}


// ─── Timeout helper ───────────────────────────────────────────────────────────
async function withTimeout<T>(fn: () => Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Основные функции ──────────────────────────────────────────────────────

/**
 * Анализирует дневной текст пользователя и классифицирует действия по подцелям
 */
export async function analyzeEntry(
  rawText: string,
  goalTitle: string,
  subcategoryNames: string[]
): Promise<AnalysisResult> {
  const client = getOpenAIClient();

  if (!client) {
    console.log('[AI] OpenAI key not set — using mock response');
    return getMockAnalysis(subcategoryNames, rawText);
  }

  const prompt = `Ты AI-коуч, помогающий людям достигать больших жизненных целей.

Цель пользователя: "${goalTitle}"
Подкатегории цели: ${subcategoryNames.join(', ')}

Текст пользователя о том, что он сделал сегодня:
"${rawText}"

Проанализируй текст и верни JSON со следующей структурой:
{
  "subcategories": [
    {
      "name": "название подкатегории из списка выше",
      "score": число от 0 до 10 (0 = нет действий, 10 = максимальный вклад),
      "actions": ["конкретное действие 1", "конкретное действие 2"],
      "comment": "краткий комментарий о вкладе в эту подкатегорию"
    }
  ],
  "totalScore": число от 0 до 100 (взвешенная оценка всего дня),
  "overallComment": "2-3 предложения: что хорошо, что можно улучшить. Мотивирующий и конкретный тон.",
  "strengths": ["сильная сторона 1", "сильная сторона 2"],
  "suggestions": ["конкретная рекомендация 1", "конкретная рекомендация 2"]
}

Важно:
- Оценивай только то, что явно есть в тексте. Не придумывай действия.
- Если по подкатегории нет действий — score = 0, actions = [].
- overallComment должен быть на русском, живым и мотивирующим, не шаблонным.
- Верни ТОЛЬКО валидный JSON, без пояснений.`;

  const response = await withTimeout(() => client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 1000,
  }), 30000);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(content);
  return AnalysisResultSchema.parse(parsed);
}

/**
 * Предлагает подкатегории для цели на основе её описания
 */
export async function suggestSubcategories(
  goalTitle: string,
  goalDescription?: string
): Promise<SuggestedSubcategory[]> {
  const client = getOpenAIClient();

  if (!client) {
    console.log('[AI] OpenAI key not set — using mock subcategories');
    return getMockSubcategories(goalTitle);
  }

  const prompt = `Пользователь ставит большую жизненную цель. Предложи 4-5 подкатегорий для трекинга прогресса.

Цель: "${goalTitle}"
${goalDescription ? `Описание: "${goalDescription}"` : ''}

Верни JSON:
{
  "subcategories": [
    {
      "name": "короткое название (1-2 слова)",
      "emoji": "один эмодзи",
      "weight": число от 0.1 до 1.0 (сумма весов = 1.0),
      "color": "hex-цвет",
      "description": "одно предложение — что сюда относится"
    }
  ]
}

Правила:
- Подкатегории должны быть конкретными и измеримыми через ежедневные действия
- Веса должны отражать реальный вклад в достижение цели
- Сумма всех weight = 1.0
- Верни ТОЛЬКО валидный JSON`;

  const response = await withTimeout(() => client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 500,
  }), 30000);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(content);
  return SuggestedSubcategoriesSchema.parse(parsed).subcategories;
}

/**
 * Генерирует еженедельный AI-отчёт
 */
export async function generateWeeklyReport(
  goalTitle: string,
  entriesSummary: {
    date: string;
    totalScore: number;
    topCategories: string[];
  }[]
): Promise<WeeklyReport> {
  const client = getOpenAIClient();

  if (!client) {
    console.log('[AI] OpenAI key not set — using mock weekly report');
    return getMockWeeklyReport();
  }

  const prompt = `Ты AI-коуч. Сгенерируй еженедельный отчёт о прогрессе пользователя.

Цель: "${goalTitle}"
Активность за неделю:
${entriesSummary.map((e) => `- ${e.date}: балл ${e.totalScore}, активные категории: ${e.topCategories.join(', ')}`).join('\n')}

Верни JSON:
{
  "summary": "2-3 предложения о неделе в целом",
  "topCategory": "название лучшей категории",
  "weakCategory": "название слабой категории",
  "trend": "improving" | "declining" | "stable",
  "insights": ["инсайт 1", "инсайт 2", "инсайт 3"],
  "nextWeekFocus": "конкретная рекомендация на следующую неделю"
}

Тон: поддерживающий, конкретный, без воды. Верни ТОЛЬКО валидный JSON.`;

  const response = await withTimeout(() => client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 600,
  }), 30000);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const parsed = JSON.parse(content);
  return WeeklyReportSchema.parse(parsed);
}
