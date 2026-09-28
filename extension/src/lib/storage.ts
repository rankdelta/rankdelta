/** Thin wrapper over `chrome.storage.local` for the API key. Never logs the value. */

const KEY_FIELD = 'rankdelta_api_key';

/** Read the stored API key, or `null` if none is set. */
export async function getApiKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get(KEY_FIELD);
  const value = stored[KEY_FIELD];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Persist (or clear, when empty) the API key. */
export async function setApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await chrome.storage.local.remove(KEY_FIELD);
    return;
  }
  await chrome.storage.local.set({ [KEY_FIELD]: trimmed });
}
