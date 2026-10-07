import { createClient } from "@supabase/supabase-js";
import type { Expense } from "@/lib/supabase";

export function createServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase 환경 변수가 설정되어 있지 않습니다.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export type { Expense };
