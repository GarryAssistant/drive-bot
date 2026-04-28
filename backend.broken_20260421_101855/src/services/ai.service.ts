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

  const prompt = `Ты AI-коуч. Твоя задача — честно и глубоко оценить день человека, идущего к большой цели.

Цель: "${goalTitle}"
Категории трекинга: ${subcategoryNames.join(', ')}

Что человек написал о своём дне:
"${rawText}"

━━ ФИЛОСОФИЯ ОЦЕНКИ ━━

Человек УЖЕ молодец — он пришёл и написал. Твоя задача не штрафовать, а честно оценить прогресс.

КАЛИБРОВКА totalScore:
• 75-90 — исключительный день: много конкретных действий по нескольким направлениям
• 55-74 — хороший продуктивный день: есть реальные действия, движение к цели
• 40-54 — обычный день: что-то сделано, но можно больше  
• 25-39 — слабый день: минимальная активность
• 10-24 — почти ничего не сделано для цели

ПРАВИЛО: если человек написал абзац про активный день — это минимум 50+. 20/100 за продуктивный день = ошибка.

СВЯЗЬ ДЕЙСТВИЙ С КАТЕГОРИЯМИ (расширенная):
- Учёба, курсы, книги → "Навыки" / "Карьерный рост" (score 5-8 в зависимости от интенсивности)
- Учёба по профессии → косвенно влияет на "Доход" (score 3-5)
- Работа, задачи, дедлайны → "Доход" / "Карьерный рост"
- Откладывание денег, бюджет → "Сбережения" / "Финансовая дисциплина"
- Спорт, здоровье → "Здоровье"
- Нетворкинг, общение с нужными людьми → "Нетворк"
- Планирование, рефлексия → 3-4 балла в профильную категорию
- Ничего конкретного по категории → 0-2

ВАЖНО: Не ставь 0 категории если человек делал что-то косвенно связанное. Учёба на программиста = вклад и в Навыки, и частично в Доход.

overallComment — ЖИВОЙ И КОНКРЕТНЫЙ:
- Упомяни что именно человек сделал сегодня (не абстрактно)
- Не пиши шаблоны типа "важно уделять внимание финансам"
- Похвали за конкретное действие из текста
- Один точечный совет на завтра

Верни JSON:
{
  "subcategories": [
    {
      "name": "название из списка",
      "score": число 0-10,
      "actions": ["конкретное действие из текста пользователя"],
      "comment": "как это приближает к цели"
    }
  ],
  "totalScore": число 0-100,
  "overallComment": "2-3 живых предложения про ЭТОТ конкретный день",
  "strengths": ["конкретная сильная сторона из текста"],
  "suggestions": ["точечный совет на основе написанного"]
}

Верни ТОЛЬКО валидный JSON, без пояснений.`;

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

  const prompt = `Ты опытный коуч, помогающий конкретному человеку достичь его цели. Тебе нужно предложить 4-5 категорий для ежедневного трекинга.

Цель: "${goalTitle}"
${goalDescription ? `Контекст о человеке: "${goalDescription}"` : ''}

ВАЖНО — правила для хороших категорий:
1. Категории должны быть ДЕЙСТВИЯ, а не абстракции. Не "Финансовая грамотность", а "Накопления" или "Доп. доход"
2. Названия — короткие, живые, как говорит реальный человек (1-2 слова)
3. Учитывай конкретный контекст человека — его возраст, работу, доход, приоритеты
4. Не повторяй одно и то же разными словами (Доход ≠ Заработок ≠ Работа)
5. Описание — конкретные примеры действий (не абстрактные определения)

Пример ПЛОХИХ категорий: Финансовая грамотность, Карьерный рост, Управление деньгами
Пример ХОРОШИХ категорий для "Купить BMW" человека-программиста 24 лет:
- 💸 Доп. доход (фриланс, пет-проекты, подработки)
- 🏦 Откладываю (сумма в копилку, % от зарплаты)
- 📈 Прокачка (навыки → зарплата выше → быстрее к цели)
- 🔌 Нетворк (полезные знакомства, менторы, возможности)

Верни JSON:
{
  "subcategories": [
    {
      "name": "короткое название 1-2 слова",
      "emoji": "один эмодзи",
      "weight": число 0.1-1.0 (сумма = 1.0),
      "color": "hex-цвет",
      "description": "2-3 примера конкретных действий через запятую"
    }
  ]
}

Верни ТОЛЬКО валидный JSON, без пояснений.`;

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

// ─── Weekly Plan ──────────────────────────────────────────────────────────────

const WeeklyPlanSchema = z.object({
  planText: z.string(),
  insights: z.string(),
});
export type WeeklyPlanResult = z.infer<typeof WeeklyPlanSchema>;

export async function generateWeeklyPlan(
  goalTitle: string,
  subcategories: { name: string; emoji: string; weight: number }[],
  entriesSummary: { date: string; totalScore: number; topCategories: string[] }[]
): Promise<WeeklyPlanResult> {
  const client = getOpenAIClient();

  if (!client) {
    return {
      planText: `📅 *План на следующую неделю*\n\n📌 Цель: *${goalTitle}*\n\n` +
        subcategories.slice(0, 3).map((s, i) => `${i + 1}. ${s.emoji} *${s.name}*\n   • Конкретное действие на эту неделю\n   • Мини-цель по категории`).join('\n\n') +
        `\n\n💡 _Сгенерировано AI на основе твоей активности_`,
      insights: 'Продолжай в том же темпе!',
    };
  }

  const subcatStr = subcategories.map(s => `${s.emoji} ${s.name} (вес ${Math.round(s.weight * 100)}%)`).join(', ');
  const historyStr = entriesSummary.length > 0
    ? entriesSummary.map(e => `- ${e.date}: балл ${e.totalScore}, активные: ${e.topCategories.join(', ')}`).join('\n')
    : 'Нет данных за прошлую неделю';

  const prompt = `Ты AI-коуч. Составь конкретный план действий на следующую неделю для пользователя.

Цель: "${goalTitle}"
Категории: ${subcatStr}

Активность за прошлую неделю:
${historyStr}

Верни JSON:
{
  "planText": "текст плана в Markdown для Telegram (используй *bold*, эмодзи). Структура: заголовок, 3-5 конкретных задач по категориям с днями недели, мотивирующий вывод",
  "insights": "1-2 инсайта по прошлой неделе (что хорошо, что подтянуть)"
}

Требования к planText:
- Конкретные задачи (не "думать о цели", а "потратить 30 минут на X")
- Привязка к дням недели (понедельник, среда, пятница...)
- Длина: 200-300 слов
- Заканчивать мотивирующей фразой
Верни ТОЛЬКО валидный JSON.`;

  const response = await withTimeout(() => client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 800,
  }), 30000);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');
  return WeeklyPlanSchema.parse(JSON.parse(content));
}
