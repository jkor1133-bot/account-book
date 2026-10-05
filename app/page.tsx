"use client";

import { FormEvent, useEffect, useState } from "react";
import { Expense, supabase } from "../lib/supabase";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount: number) {
  return amount.toLocaleString("ko-KR");
}

const fieldClassName =
  "h-14 w-full rounded-xl bg-white px-4 text-lg text-foreground outline-none transition placeholder:text-muted/50 focus:bg-white focus:ring-2 focus:ring-accent/10 sm:h-12 sm:text-[15px]";

const labelClassName = "text-[15px] font-medium tracking-tight text-muted sm:text-sm";

export default function Home() {
  const [date, setDate] = useState(todayString);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExpenses() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("expenses")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        setExpenses([]);
      } else {
        setExpenses(data ?? []);
      }

      setLoading(false);
    }

    void loadExpenses();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (!date || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("expenses").insert({
      date,
      amount: parsedAmount,
      description: description.trim(),
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setSaving(false);
      return;
    }

    setExpenses(data ?? []);
    setAmount("");
    setDescription("");
    setDate(todayString());
    setSaving(false);
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="bg-background">
        <div className="mx-auto w-full max-w-lg px-5 pt-10 pb-2 sm:px-6 sm:pt-14">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight sm:text-[2.25rem]">
            나의 AI 가계부
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-10 px-5 py-8 sm:gap-12 sm:px-6 sm:py-10">
        <section className="w-full rounded-2xl bg-surface-subtle/70 px-5 py-6 sm:px-7 sm:py-8">
          <div className="mb-8">
            <h2 className="text-lg font-semibold tracking-tight sm:text-base">지출 내역 입력</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted sm:text-sm">
              날짜, 금액, 내용을 입력한 뒤 저장하세요.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-7 sm:gap-6">
            <label className="flex flex-col gap-2.5">
              <span className={labelClassName}>날짜</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className={fieldClassName}
              />
            </label>

            <label className="flex flex-col gap-2.5">
              <span className={labelClassName}>금액</span>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                  required
                  className={`${fieldClassName} pr-12 font-mono tabular-nums tracking-tight`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[15px] text-muted">
                  원
                </span>
              </div>
            </label>

            <label className="flex flex-col gap-2.5">
              <span className={labelClassName}>내용</span>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="예: 점심 식사, 교통비"
                required
                className={fieldClassName}
              />
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-[15px] leading-relaxed text-red-600 sm:text-sm">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="mt-1 min-h-14 touch-manipulation rounded-xl bg-accent text-[17px] font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 sm:mt-2 sm:h-12 sm:min-h-12 sm:text-[15px]"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
          </form>
        </section>

        <section className="w-full">
          <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight sm:text-base">지출 목록</h2>
              <p className="mt-2 text-[15px] text-muted sm:text-sm">
                {loading
                  ? "불러오는 중..."
                  : expenses.length === 0
                    ? "아직 저장된 내역이 없습니다."
                    : `${expenses.length}건`}
              </p>
            </div>
            {!loading && expenses.length > 0 && (
              <div className="sm:text-right">
                <p className="text-[13px] font-medium tracking-wide text-muted uppercase">합계</p>
                <p className="mt-1 font-mono text-2xl font-medium tracking-tight tabular-nums sm:text-[1.75rem]">
                  {formatAmount(total)}
                  <span className="ml-1 text-base font-sans font-normal text-muted">원</span>
                </p>
              </div>
            )}
          </div>

          <ul className="flex flex-col gap-3">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex items-center justify-between gap-5 rounded-2xl bg-surface px-5 py-5 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-medium tracking-tight sm:text-[15px]">
                    {expense.description}
                  </p>
                  <p className="mt-1.5 text-[14px] text-muted sm:text-[13px]">{expense.date}</p>
                </div>
                <p className="shrink-0 font-mono text-xl font-medium tracking-tight tabular-nums sm:text-lg">
                  -{formatAmount(expense.amount)}
                  <span className="ml-0.5 text-sm font-sans font-normal text-muted">원</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
