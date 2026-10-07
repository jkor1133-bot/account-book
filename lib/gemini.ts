import { GoogleGenerativeAI } from "@google/generative-ai";

export type ChatHistoryItem = {
  role: "user" | "model";
  text: string;
};

export type ParsedExpense = {
  date: string;
  amount: number;
  description: string;
};

type GeminiExpensePayload = {
  DATE?: string | null;
  AMOUNT?: number | string | null;
  DESCRIPTION?: string | null;
  date?: string | null;
  amount?: number | string | null;
  description?: string | null;
  reply?: string | null;
  message?: string | null;
  needs_clarification?: boolean | null;
};

function todayInSeoul() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function seoulTodayDate() {
  const [year, month, day] = todayInSeoul().split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftSeoulDate(days: number) {
  const date = seoulTodayDate();
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function yesterdayInSeoul() {
  return shiftSeoulDate(-1);
}

const WEEKDAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function mondayBasedIndex(jsWeekday: number) {
  // JS: Sun=0 ... Sat=6  →  Mon=0 ... Sun=6
  return (jsWeekday + 6) % 7;
}

function dateForWeekday(targetWeekday: number, weekOffset: number) {
  // weekOffset 0 = this week, -1 = last week (Monday-start weeks)
  const today = seoulTodayDate();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - mondayBasedIndex(today.getDay()));

  const targetMonday = new Date(thisMonday);
  targetMonday.setDate(thisMonday.getDate() + weekOffset * 7);

  const target = new Date(targetMonday);
  target.setDate(targetMonday.getDate() + mondayBasedIndex(targetWeekday));
  return formatLocalDate(target);
}

function parseKoreanAmount(text: string): number | null {
  const normalized = text.replace(/,/g, "");

  const manCheon = normalized.match(/(\d+)\s*만\s*(\d+)\s*천/);
  if (manCheon) {
    return Number(manCheon[1]) * 10000 + Number(manCheon[2]) * 1000;
  }

  const man = normalized.match(/(\d+)\s*만\s*원?/);
  if (man) {
    return Number(man[1]) * 10000;
  }

  const cheon = normalized.match(/(\d+)\s*천\s*원?/);
  if (cheon) {
    return Number(cheon[1]) * 1000;
  }

  const plain = normalized.match(/(\d+)\s*원/);
  if (plain) {
    return Number(plain[1]);
  }

  return null;
}

function parseWeekdayToken(text: string): number | null {
  const match = text.match(/(월|화|수|목|금|토|일)\s*요일?/);
  if (!match) return null;
  return WEEKDAY_INDEX[match[1]] ?? null;
}

function parseKoreanDate(text: string): string | null {
  const full = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (full) {
    const [, year, month, day] = full;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const year = todayInSeoul().slice(0, 4);
    return `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }

  const daysAgo = text.match(/(\d+)\s*일\s*전/);
  if (daysAgo) {
    return shiftSeoulDate(-Number(daysAgo[1]));
  }

  if (/그저께|그제/.test(text)) {
    return shiftSeoulDate(-2);
  }

  if (text.includes("어제")) {
    return yesterdayInSeoul();
  }

  if (text.includes("오늘") || text.includes("방금")) {
    return todayInSeoul();
  }

  const weekday = parseWeekdayToken(text);
  if (weekday != null) {
    if (text.includes("지난주") || text.includes("저번주")) {
      return dateForWeekday(weekday, -1);
    }
    if (text.includes("다음주")) {
      return dateForWeekday(weekday, 1);
    }
    if (text.includes("이번주")) {
      return dateForWeekday(weekday, 0);
    }
    // bare weekday → most recent past (or today if same weekday)
    const today = seoulTodayDate();
    const diff = (today.getDay() - weekday + 7) % 7;
    return shiftSeoulDate(diff === 0 ? 0 : -diff);
  }

  if (text.includes("지난주") || text.includes("저번주")) {
    // "지난주" alone → same weekday last week
    return shiftSeoulDate(-7);
  }

  return null;
}

function hasExplicitOrRelativeDate(text: string) {
  return /(\d{4}\s*년)?\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d+\s*일\s*전|그저께|그제|어제|오늘|방금|지난주|저번주|이번주|다음주|(월|화|수|목|금|토|일)\s*요일?/.test(
    text,
  );
}

function parseKoreanDescription(text: string): string | null {
  const cleaned = text
    .replace(/(\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\d+\s*일\s*전/g, " ")
    .replace(/그저께|그제|오늘|어제|방금/g, " ")
    .replace(/지난주|저번주|이번주|다음주/g, " ")
    .replace(/(월요일|화요일|수요일|목요일|금요일|토요일|일요일)/g, " ")
    .replace(/\d+\s*만\s*\d*\s*천?\s*원?/g, " ")
    .replace(/\d+\s*천\s*원?/g, " ")
    .replace(/\d[\d,]*\s*원/g, " ")
    .replace(
      /썼어|썼다|나왔어|결제|지불|으로|인데|는데|본\s*것|보는|보는데|에|을|를|이|가|은|는|한테|에서|먹었어|마셨어|탔어|샀어|탄|한/g,
      " ",
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens[0] === "장") {
    return "장보기";
  }

  return tokens[0] ?? null;
}

/** Fast path for obvious Korean expense sentences without calling Gemini. */
export function tryParseExpenseLocally(message: string): ParsedExpense | null {
  if (isStatisticsQuestion(message)) {
    return null;
  }

  const amount = parseKoreanAmount(message);
  if (amount == null || amount <= 0) {
    return null;
  }

  const parsedDate = parseKoreanDate(message);
  if (!parsedDate) {
    // Relative/explicit date phrase present but unresolved → don't force today.
    if (hasExplicitOrRelativeDate(message)) {
      return null;
    }
  }

  const date = parsedDate ?? todayInSeoul();
  const description = parseKoreanDescription(message);
  if (!description) {
    return null;
  }

  return { date, amount, description };
}

/** Amount present → expense input. Interrogatives without amount → stats question. */
export function isStatisticsQuestion(message: string): boolean {
  if (parseKoreanAmount(message) != null) {
    return false;
  }

  return /(얼마|뭐|어떻게|어디|언제|왜|어느|몇|총(?:\s*지출)?|합계|알려\s*줘|궁금|보여\s*줘|정리|통계|요약|내역|목록|\?|？)/.test(
    message,
  );
}

function thisMonthRange() {
  const today = todayInSeoul();
  const [year, month] = today.split("-");
  return {
    start: `${year}-${month}-01`,
    end: today,
  };
}

function thisWeekRange() {
  const today = seoulTodayDate();
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayBasedIndex(today.getDay()));
  return {
    start: formatLocalDate(monday),
    end: todayInSeoul(),
  };
}

function lastWeekRange() {
  const today = seoulTodayDate();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - mondayBasedIndex(today.getDay()));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return {
    start: formatLocalDate(lastMonday),
    end: formatLocalDate(lastSunday),
  };
}

function buildStatsSystemInstruction() {
  const today = todayInSeoul();
  const yesterday = yesterdayInSeoul();
  const month = thisMonthRange();
  const thisWeek = thisWeekRange();
  const lastWeek = lastWeekRange();

  return `당신은 친근한 한국어 AI 가계부 비서입니다.
주어진 지출 데이터만 근거로 사용자 질문에 답하세요.

날짜 기준(아시아/서울):
- 오늘: ${today}
- 어제: ${yesterday}
- 이번 달: ${month.start} ~ ${month.end}
- 이번 주(월~오늘): ${thisWeek.start} ~ ${thisWeek.end}
- 지난주(월~일): ${lastWeek.start} ~ ${lastWeek.end}

규칙:
1. 금액은 천 단위 콤마와 "원"을 붙여 읽기 쉽게 말하세요.
2. 데이터가 없으면 없다고 솔직히 알려주세요.
3. 추측으로 없는 지출을 만들지 마세요.
4. 2~4문장 정도로 자연스럽고 친근하게 답하세요.
5. JSON이 아니라 일반 한국어 문장만 출력하세요.`;
}

function buildSystemInstruction() {
  const today = todayInSeoul();
  const yesterday = yesterdayInSeoul();
  const threeDaysAgo = shiftSeoulDate(-3);
  const lastFriday = dateForWeekday(5, -1);
  const lastTuesday = dateForWeekday(2, -1);

  return `당신은 한국어 AI 가계부 어시스턴트입니다.
사용자 메시지에서 지출 정보(날짜, 금액, 내용)를 추출하세요.

기준 날짜:
- 오늘: ${today}
- 어제: ${yesterday}
- 3일 전: ${threeDaysAgo}
- 지난주 금요일: ${lastFriday}
- 지난주 화요일: ${lastTuesday}

추출 규칙:
1. 날짜가 없으면 DATE는 "${today}"를 사용하세요.
2. 상대 날짜를 반드시 계산하세요. 예: "어제"→${yesterday}, "3일 전"→${threeDaysAgo}, "지난주 금요일"→${lastFriday}
3. AMOUNT는 정수(원)입니다. 예: "2만원" → 20000, "1만5천" → 15000, "8,500원" → 8500
4. DESCRIPTION은 짧은 한국어 명사/구로 정리하세요. 예: "택시 탔는데" → "택시", "영화 보는데" → "영화", "장 본 것" → "장보기"
5. DESCRIPTION에 날짜 표현(지난주, 3일 전, 금요일 등)을 넣지 마세요.
6. 날짜 또는 금액을 확실히 알 수 없으면 DATE/AMOUNT/DESCRIPTION을 모두 null로 두고 needs_clarification을 true로 하세요.
7. 반드시 JSON만 출력하세요.

성공 예시:
{"DATE":"${lastFriday}","AMOUNT":50000,"DESCRIPTION":"장보기","needs_clarification":false}

정보 부족 예시:
{"DATE":null,"AMOUNT":null,"DESCRIPTION":null,"needs_clarification":true,"reply":"금액을 알려주시겠어요?"}`;
}

function normalizeExpense(payload: GeminiExpensePayload): ParsedExpense | null {
  const date = payload.DATE ?? payload.date;
  const amountRaw = payload.AMOUNT ?? payload.amount;
  const description = payload.DESCRIPTION ?? payload.description;

  if (!date || amountRaw == null || !description) {
    return null;
  }

  const amount =
    typeof amountRaw === "string"
      ? Number(amountRaw.replace(/[^\d.-]/g, ""))
      : Number(amountRaw);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const normalizedDescription = String(description).trim();
  if (!normalizedDescription) {
    return null;
  }

  return {
    date: String(date),
    amount: Math.round(amount),
    description: normalizedDescription,
  };
}

function clarificationMessage(payload: GeminiExpensePayload) {
  if (payload.reply && typeof payload.reply === "string") {
    return payload.reply;
  }
  if (payload.message && typeof payload.message === "string") {
    return payload.message;
  }
  return "날짜나 금액을 정확히 파악하지 못했어요. 예: \"오늘 점심 15000원\"처럼 다시 알려주세요.";
}

function formatConfirmReply(expense: ParsedExpense) {
  const [, month, day] = expense.date.split("-");
  const monthLabel = month ? `${Number(month)}월` : "";
  const dayLabel = day ? `${Number(day)}일` : expense.date;
  const dateLabel = month ? `${monthLabel} ${dayLabel}`.trim() : expense.date;
  const amountLabel = expense.amount.toLocaleString("ko-KR");

  return `${dateLabel} ${expense.description} ${amountLabel}원을 저장했어요!`;
}

function extractJsonObject(text: string): GeminiExpensePayload {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate) as GeminiExpensePayload;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Gemini 응답 시간이 초과되었습니다.")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateWithGemini(
  message: string,
  history: ChatHistoryItem[],
  apiKey: string,
  options?: {
    systemInstruction?: string;
    responseMimeType?: string;
    temperature?: number;
    timeoutMs?: number;
  },
) {
  const models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.8-flash"];
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown;

  for (const modelName of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: options?.systemInstruction ?? buildSystemInstruction(),
          generationConfig: {
            temperature: options?.temperature ?? 0.2,
            ...(options?.responseMimeType
              ? { responseMimeType: options.responseMimeType }
              : {}),
          },
        });

        const chat = model.startChat({
          history: history.map((item) => ({
            role: item.role,
            parts: [{ text: item.text }],
          })),
        });

        const result = await withTimeout(
          chat.sendMessage(message),
          options?.timeoutMs ?? 12000,
        );
        return result.response.text();
      } catch (error) {
        lastError = error;
        const status =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof (error as { status?: unknown }).status === "number"
            ? (error as { status: number }).status
            : undefined;

        if (status === 503 || status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }

        if (status === 404) {
          break;
        }

        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini API 호출에 실패했습니다.");
}

export type ExpenseRecord = {
  date: string;
  amount: number;
  description: string;
};

function formatWon(amount: number) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function sumAmounts(items: ExpenseRecord[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function inDateRange(item: ExpenseRecord, start: string, end: string) {
  return item.date >= start && item.date <= end;
}

function extractQuestionCategory(question: string): string | null {
  const known = [
    "장보기",
    "점심",
    "저녁",
    "아침",
    "커피",
    "택시",
    "교통",
    "영화",
    "회식",
    "간식",
    "배달",
  ];
  for (const word of known) {
    if (question.includes(word)) return word;
  }
  return null;
}

function listExpenseSummary(items: ExpenseRecord[]) {
  return items
    .map((item) => `${item.description} ${formatWon(item.amount)}`)
    .join(", ");
}

/** Deterministic answers for common stats questions (Gemini-independent). */
export function answerExpenseQuestionLocally(
  question: string,
  expenses: ExpenseRecord[],
): string | null {
  const month = thisMonthRange();
  const thisWeek = thisWeekRange();
  const lastWeek = lastWeekRange();
  const yesterday = yesterdayInSeoul();
  const today = todayInSeoul();
  const category = extractQuestionCategory(question);

  const monthItems = expenses.filter((item) =>
    inDateRange(item, month.start, month.end),
  );
  const weekItems = expenses.filter((item) =>
    inDateRange(item, thisWeek.start, thisWeek.end),
  );
  const lastWeekItems = expenses.filter((item) =>
    inDateRange(item, lastWeek.start, lastWeek.end),
  );
  const yesterdayItems = expenses.filter((item) => item.date === yesterday);
  const todayItems = expenses.filter((item) => item.date === today);

  if (/어제/.test(question)) {
    if (yesterdayItems.length === 0) {
      return `어제(${yesterday})에는 기록된 지출이 없어요.`;
    }
    if (/뭐|무엇|내역|샀/.test(question)) {
      return `어제에는 ${listExpenseSummary(yesterdayItems)} 쓰셨어요. 합계는 ${formatWon(sumAmounts(yesterdayItems))}이에요.`;
    }
    if (/얼마|총|합계/.test(question)) {
      return `어제 총 지출은 ${formatWon(sumAmounts(yesterdayItems))}이에요. (${yesterdayItems.length}건)`;
    }
  }

  if (/오늘/.test(question) && (/얼마|총|합계|뭐|내역/.test(question))) {
    if (todayItems.length === 0) {
      return `오늘(${today})에는 아직 기록된 지출이 없어요.`;
    }
    if (/뭐|내역/.test(question)) {
      return `오늘은 ${listExpenseSummary(todayItems)} 쓰셨어요. 합계는 ${formatWon(sumAmounts(todayItems))}이에요.`;
    }
    return `오늘 총 지출은 ${formatWon(sumAmounts(todayItems))}이에요. (${todayItems.length}건)`;
  }

  if (/지난주|저번주/.test(question)) {
    const target = category
      ? lastWeekItems.filter((item) => item.description.includes(category))
      : lastWeekItems;
    if (target.length === 0) {
      return category
        ? `지난주(${lastWeek.start}~${lastWeek.end})에는 '${category}' 지출이 없어요.`
        : `지난주(${lastWeek.start}~${lastWeek.end})에는 기록된 지출이 없어요.`;
    }
    if (category) {
      return `지난주 '${category}' 지출은 ${formatWon(sumAmounts(target))}이에요. (${target.length}건)`;
    }
    if (/뭐|내역/.test(question)) {
      return `지난주에는 ${listExpenseSummary(target)} 쓰셨어요. 합계는 ${formatWon(sumAmounts(target))}이에요.`;
    }
    return `지난주 총 지출은 ${formatWon(sumAmounts(target))}이에요. (${target.length}건, ${lastWeek.start}~${lastWeek.end})`;
  }

  if (/이번\s*주/.test(question)) {
    const target = category
      ? weekItems.filter((item) => item.description.includes(category))
      : weekItems;
    if (target.length === 0) {
      return category
        ? `이번 주에는 '${category}' 지출이 없어요.`
        : "이번 주에는 아직 기록된 지출이 없어요.";
    }
    if (category) {
      return `이번 주 '${category}' 지출은 ${formatWon(sumAmounts(target))}이에요. (${target.length}건)`;
    }
    return `이번 주 총 지출은 ${formatWon(sumAmounts(target))}이에요. (${target.length}건)`;
  }

  if (/이번\s*달|이달/.test(question)) {
    const target = category
      ? monthItems.filter((item) => item.description.includes(category))
      : monthItems;
    if (target.length === 0) {
      return category
        ? `이번 달에는 '${category}' 지출이 없어요.`
        : "이번 달에는 아직 기록된 지출이 없어요.";
    }
    if (category) {
      return `이번 달 '${category}'에 ${formatWon(sumAmounts(target))} 쓰셨어요. (${target.length}건)`;
    }
    return `이번 달 총 지출은 ${formatWon(sumAmounts(target))}이에요. 총 ${target.length}건이 기록되어 있어요.`;
  }

  if (category && /얼마|총|합계/.test(question)) {
    const target = expenses.filter((item) => item.description.includes(category));
    if (target.length === 0) {
      return `'${category}'으로 저장된 지출은 아직 없어요.`;
    }
    return `'${category}' 전체 합계는 ${formatWon(sumAmounts(target))}이에요. (${target.length}건)`;
  }

  if (/총\s*지출|전체\s*합계|지금까지/.test(question)) {
    return `지금까지 총 지출은 ${formatWon(sumAmounts(expenses))}이에요. 총 ${expenses.length}건이 있어요.`;
  }

  return null;
}

export async function answerExpenseQuestion(
  question: string,
  expenses: ExpenseRecord[],
): Promise<string> {
  if (expenses.length === 0) {
    return "아직 저장된 지출이 없어요. 먼저 \"오늘 점심 8000원\"처럼 지출을 알려주시면 통계도 도와드릴게요!";
  }

  const localAnswer = answerExpenseQuestionLocally(question, expenses);
  if (localAnswer) {
    return localAnswer;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "질문은 이해했지만, 지금은 기본 통계만 바로 답할 수 있어요. \"이번 달 총 지출이 얼마야?\"처럼 물어봐 주세요.";
  }

  const compact = expenses.map((item) => ({
    date: item.date,
    amount: item.amount,
    description: item.description,
  }));

  const prompt = `사용자 질문: ${question}

지출 데이터(JSON):
${JSON.stringify(compact, null, 2)}

위 데이터만 보고 질문에 친근하게 답해주세요.`;

  try {
    const text = await generateWithGemini(prompt, [], apiKey, {
      systemInstruction: buildStatsSystemInstruction(),
      temperature: 0.5,
      timeoutMs: 12000,
    });

    return (
      text.trim() ||
      "데이터를 확인했지만 답변을 만들지 못했어요. 질문을 조금 바꿔볼까요?"
    );
  } catch (error) {
    console.error("Gemini stats failed:", error);
    // Last-resort summary so the chat never feels broken.
    return `지금은 AI 상세 분석이 불안정해서, 전체 합계만 알려드릴게요. 총 ${formatWon(sumAmounts(expenses))} (${expenses.length}건)이에요. \"이번 달 총 지출이 얼마야?\"처럼 물어보시면 바로 계산해 드릴게요.`;
  }
}

export async function analyzeExpenseMessage(
  message: string,
  history: ChatHistoryItem[] = [],
): Promise<{ reply: string; expense: ParsedExpense | null }> {
  const localExpense = tryParseExpenseLocally(message);
  if (localExpense) {
    return {
      reply: formatConfirmReply(localExpense),
      expense: localExpense,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      reply:
        "AI 설정이 아직 완료되지 않았어요. \"오늘 점심 15000원\"처럼 날짜·금액·내용을 함께 보내 주세요.",
      expense: null,
    };
  }

  try {
    const text = await generateWithGemini(message, history, apiKey, {
      responseMimeType: "application/json",
    });
    const payload = extractJsonObject(text);
    const expense = normalizeExpense(payload);

    if (!expense || payload.needs_clarification) {
      return {
        reply: clarificationMessage(payload),
        expense: null,
      };
    }

    return {
      reply: formatConfirmReply(expense),
      expense,
    };
  } catch (error) {
    console.error("Gemini analyze failed:", error);
    return {
      reply:
        "지금은 AI 분석이 불안정해요. \"어제 커피 4500원\"처럼 조금 더 명확히 다시 보내 주세요.",
      expense: null,
    };
  }
}
