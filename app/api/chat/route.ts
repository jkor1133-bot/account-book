import {
  analyzeExpenseMessage,
  answerExpenseQuestion,
  isStatisticsQuestion,
  type ChatHistoryItem,
} from "@/lib/gemini";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      history?: ChatHistoryItem[];
    };

    const message = body.message?.trim();
    if (!message) {
      return Response.json({
        reply: "메시지를 입력해주세요.",
        expense: null,
        saved: false,
      });
    }

    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const supabase = createServerSupabase();

    // Stats / lookup questions → fetch all expenses and ask Gemini.
    if (isStatisticsQuestion(message)) {
      const { data, error } = await supabase
        .from("expenses")
        .select("date, amount, description")
        .order("date", { ascending: false });

      if (error) {
        console.error("Supabase fetch error:", error);
        return Response.json({
          reply: "지출 데이터를 불러오지 못했어요. 잠시 후 다시 물어봐 주세요.",
          expense: null,
          saved: false,
          type: "question",
        });
      }

      const reply = await answerExpenseQuestion(message, data ?? []);
      return Response.json({
        reply,
        expense: null,
        saved: false,
        type: "question",
      });
    }

    let analysis: Awaited<ReturnType<typeof analyzeExpenseMessage>>;
    try {
      analysis = await analyzeExpenseMessage(message, history);
    } catch (error) {
      console.error("Gemini API error:", error);
      return Response.json({
        reply:
          "죄송해요. 지금 AI 응답이 원활하지 않아요. \"오늘 점심 15000원\"처럼 다시 보내 주시겠어요?",
        expense: null,
        saved: false,
        type: "expense",
      });
    }

    if (!analysis.expense) {
      return Response.json({
        reply: analysis.reply,
        expense: null,
        saved: false,
        type: "expense",
      });
    }

    const { data, error: insertError } = await supabase
      .from("expenses")
      .insert({
        date: analysis.expense.date,
        amount: analysis.expense.amount,
        description: analysis.expense.description,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);

      const { error: retryError } = await supabase.from("expenses").insert({
        date: analysis.expense.date,
        amount: analysis.expense.amount,
        description: analysis.expense.description,
      });

      if (retryError) {
        return Response.json({
          reply:
            "지출 내용은 이해했지만 저장에 실패했어요. 잠시 후 다시 시도해 주세요.",
          expense: {
            DATE: analysis.expense.date,
            AMOUNT: analysis.expense.amount,
            DESCRIPTION: analysis.expense.description,
          },
          saved: false,
          type: "expense",
        });
      }

      return Response.json({
        reply: analysis.reply,
        expense: {
          DATE: analysis.expense.date,
          AMOUNT: analysis.expense.amount,
          DESCRIPTION: analysis.expense.description,
        },
        saved: true,
        record: null,
        type: "expense",
      });
    }

    return Response.json({
      reply: analysis.reply,
      expense: {
        DATE: analysis.expense.date,
        AMOUNT: analysis.expense.amount,
        DESCRIPTION: analysis.expense.description,
      },
      saved: true,
      record: data,
      type: "expense",
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json({
      reply: "죄송해요. 일시적인 오류가 발생했어요. 다시 한 번 보내 주세요.",
      expense: null,
      saved: false,
    });
  }
}
