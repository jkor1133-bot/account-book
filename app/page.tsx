"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Expense, supabase } from "@/lib/supabase";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function formatAmount(amount: number) {
  return amount.toLocaleString("ko-KR");
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "안녕하세요! 지출 기록이나 통계 질문을 편하게 말씀해 주세요.\n예: \"오늘 점심 8,500원\" / \"이번 달 총 지출이 얼마야?\"",
};

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadExpenses() {
    setLoadingExpenses(true);
    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
    } else {
      setError(null);
      setExpenses(data ?? []);
    }
    setLoadingExpenses(false);
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const history = messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.role === "user" ? ("user" as const) : ("model" as const),
          text: message.text,
        }));

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const payload = (await response.json()) as {
        reply?: string;
        expense?: {
          DATE?: string;
          AMOUNT?: number;
          DESCRIPTION?: string;
          date?: string;
          amount?: number;
          description?: string;
        } | null;
        saved?: boolean;
        error?: string;
      };

      const reply =
        payload.reply ||
        payload.error ||
        "죄송해요. 응답을 이해하지 못했어요. 다시 보내 주세요.";

      if (payload.saved) {
        await loadExpenses();
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: reply,
        },
      ]);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: isAbort
            ? "죄송해요. 응답이 조금 지연되고 있어요. 같은 내용을 다시 보내 주시겠어요?"
            : "죄송해요. 일시적인 문제가 있었어요. 다시 한 번 보내 주세요.",
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-black/5 bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">AI 가계부 챗봇</h1>
          {!loadingExpenses && expenses.length > 0 && (
            <p className="shrink-0 font-mono text-sm tabular-nums text-muted sm:text-base">
              합계 {formatAmount(total)}원
            </p>
          )}
        </div>
      </header>

      <section className="shrink-0 border-b border-black/5 bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">저장된 지출</h2>
            <span className="text-xs text-muted">
              {loadingExpenses ? "불러오는 중..." : `${expenses.length}건`}
            </span>
          </div>

          {expenses.length === 0 && !loadingExpenses ? (
            <p className="rounded-2xl bg-surface px-4 py-4 text-sm text-muted">
              아직 저장된 내역이 없습니다. 채팅으로 지출을 알려주세요.
            </p>
          ) : (
            <ul className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {expenses.map((expense) => (
                <li
                  key={expense.id}
                  className="min-w-[11.5rem] shrink-0 rounded-2xl bg-surface px-4 py-3"
                >
                  <p className="truncate text-[15px] font-medium tracking-tight">
                    {expense.description}
                  </p>
                  <p className="mt-1 text-xs text-muted">{expense.date}</p>
                  <p className="mt-2 font-mono text-lg font-medium tracking-tight tabular-nums">
                    -{formatAmount(expense.amount)}
                    <span className="ml-0.5 text-xs font-sans font-normal text-muted">원</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap sm:max-w-[75%] sm:text-sm ${
                    isUser
                      ? "rounded-br-md bg-accent text-white"
                      : "rounded-bl-md bg-surface text-foreground"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-sm text-muted">
                입력 중...
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <div ref={chatEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-black/5 bg-surface px-3 py-3 sm:px-6 sm:py-4"
        >
          <div className="flex items-end gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="예: 오늘 점심 8500원 / 이번 달 총지출 얼마야?"
              disabled={sending}
              className="min-h-12 flex-1 rounded-2xl bg-surface-subtle px-4 text-[16px] text-foreground outline-none transition placeholder:text-muted/60 focus:ring-2 focus:ring-accent/10 disabled:opacity-60 sm:min-h-11 sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="min-h-12 shrink-0 touch-manipulation rounded-2xl bg-accent px-5 text-[15px] font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11"
            >
              전송
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
