/** Options page: save the API key and validate it with a tools/list call. */

import { looksLikeApiKey } from '../lib/hostname';
import { testApiKey } from '../lib/mcp';
import { getApiKey, setApiKey } from '../lib/storage';

const keyInput = document.getElementById('key') as HTMLInputElement;
const revealBox = document.getElementById('reveal') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testBtn = document.getElementById('test') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

function setStatus(message: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  statusEl.textContent = message;
  statusEl.className = `status${kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : ''}`;
}

async function load(): Promise<void> {
  const existing = await getApiKey();
  if (existing) keyInput.value = existing;
}

revealBox.addEventListener('change', () => {
  keyInput.type = revealBox.checked ? 'text' : 'password';
});

saveBtn.addEventListener('click', async () => {
  const value = keyInput.value.trim();
  if (value && !looksLikeApiKey(value)) {
    setStatus('That does not look like a sk_rankdelta_… key.', 'err');
    return;
  }
  await setApiKey(value);
  setStatus(value ? 'Saved.' : 'Key cleared.', 'ok');
});

testBtn.addEventListener('click', async () => {
  const value = keyInput.value.trim();
  if (!value) {
    setStatus('Enter a key first.', 'err');
    return;
  }
  setStatus('Testing…', 'info');
  testBtn.disabled = true;
  try {
    const outcome = await testApiKey(value);
    if (outcome.ok) {
      setStatus(`Key OK — ${outcome.data} tool${outcome.data === 1 ? '' : 's'} available.`, 'ok');
    } else if (outcome.kind === 'unauthorized') {
      setStatus('Invalid or expired key.', 'err');
    } else {
      setStatus(outcome.message, 'err');
    }
  } finally {
    testBtn.disabled = false;
  }
});

void load();
