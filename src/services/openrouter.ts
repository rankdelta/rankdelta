/**
 * OpenRouter client — Kimi K2 as primary model (cheapest viable quality).
 * Falls back to Claude Sonnet for orchestration tasks requiring reasoning.
 *
 * Pricing (OpenRouter, June 2026):
 *   kimi-k2:     $0.15/1M input,  $2.50/1M output  (~€0.02/article)
 *   claude-sonnet: $3/1M input,  $15/1M output     (orchestration only)
 *
 * All API calls go through this service — keys stay server-side (Edge Functions).
 * In dev mode, keys are loaded from VITE_* env vars with a console warning.
 */

import { isProxyEnabled, proxyLLM } from './edgeProxy'

export type OpenRouterModel =
  | 'moonshotai/kimi-k2'           // primary: articles, SEO content (best quality/$ for long-form)
  | 'moonshotai/kimi-k2:free'      // free tier for testing
  | 'anthropic/claude-sonnet-4-6'  // orchestration + complex reasoning
  | 'anthropic/claude-haiku-4-5'   // fast classification
  | 'openai/gpt-4o'                // long-form writing: fast + reliable within the Edge proxy window
  | 'openai/gpt-4o-mini'           // cheapest output ($0.60/1M) — mechanical passes: proofread, meta JSON

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenRouterResponse {
  id: string
  choices: Array<{
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  model: string
}

export interface CompletionOptions {
  model?: OpenRouterModel
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  /** Per-call timeout in ms (default 120s). Prevents a stalled upstream from hanging generation. */
  timeoutMs?: number
}

export async function complete(
  messages: OpenRouterMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  const {
    model = 'moonshotai/kimi-k2',
    temperature = 0.7,
    maxTokens = 8192,
    systemPrompt,
  } = options

  const allMessages: OpenRouterMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  // All LLM calls route through the Edge Function so the provider key stays server-side and is
  // NEVER bundled into the client. The proxy resolves the provider (OpenRouter → OpenAI) from its
  // own secrets. There is no client-side key fallback by design.
  if (!isProxyEnabled()) {
    throw new Error('Proxy LLM non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret della Edge Function seo-proxy.')
  }
  return proxyLLM({ model, messages: allMessages, temperature, maxTokens, timeoutMs: options.timeoutMs })
}

/** Cheaper wrapper for short classification/extraction tasks */
export async function classify(prompt: string, context: string): Promise<string> {
  return complete(
    [{ role: 'user', content: `${prompt}\n\n${context}` }],
    { model: 'anthropic/claude-haiku-4-5', temperature: 0.1, maxTokens: 512 }
  )
}

/** High-quality wrapper for orchestration/planning decisions */
export async function orchestrate(systemPrompt: string, userPrompt: string): Promise<string> {
  return complete(
    [{ role: 'user', content: userPrompt }],
    { model: 'anthropic/claude-sonnet-4-6', temperature: 0.3, maxTokens: 4096, systemPrompt }
  )
}

/** Estimate cost for a completion in EUR cents */
export function estimateCostCents(
  inputTokens: number,
  outputTokens: number,
  model: OpenRouterModel = 'moonshotai/kimi-k2'
): number {
  const pricing: Record<OpenRouterModel, { input: number; output: number }> = {
    'moonshotai/kimi-k2':           { input: 0.15,  output: 2.50  },
    'moonshotai/kimi-k2:free':      { input: 0,     output: 0     },
    'anthropic/claude-sonnet-4-6':  { input: 3.0,   output: 15.0  },
    'anthropic/claude-haiku-4-5':   { input: 1.0,   output: 5.0   },
    'openai/gpt-4o':                { input: 2.5,   output: 10.0  },
    'openai/gpt-4o-mini':           { input: 0.15,  output: 0.60  },
  }
  const p = pricing[model]
  const usd = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
  return Math.round(usd * 100 * 1.1) // EUR cents with 10% buffer
}
