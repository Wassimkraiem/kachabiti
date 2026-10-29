// USD per million tokens (Anthropic list prices, 2026-10) and per hour of audio (Groq). Update
// here when prices change; assistant_runs.cost_usd is computed from them at write time.
export const MODEL_PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
};

// shortcut: Groq's whisper-large-v3 list price as of 2026-10; check console.groq.com/pricing.
export const AUDIO_PRICE_PER_HOUR = 0.111;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cost of one API response. `input_tokens` is the uncached remainder only. */
export function costOf(model: string, usage: Usage): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
    1_000_000
  );
}

export const audioCost = (seconds: number) =>
  (seconds / 3600) * AUDIO_PRICE_PER_HOUR;
