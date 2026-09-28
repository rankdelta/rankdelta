-- Add Grok (xAI) as optional AI visibility engine via OpenRouter.

ALTER TYPE llm_provider ADD VALUE IF NOT EXISTS 'grok';
