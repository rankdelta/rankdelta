/**
 * The result email of the free AI-visibility check — the first message most leads ever get from
 * Rankdelta, in the language of the page they used (`lang`, EN fallback).
 *
 * Kept out of index.ts (which starts a server on import) so it can be rendered and tested.
 */

import { appOrigin } from '../_shared/appOrigin.ts'

export const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type CheckEmailResult = {
  brand: string
  query: string
  level: 'recommended' | 'known' | 'absent' | string
  competitors?: string[]
}

const SITE = appOrigin()
const SITE_HOST = new URL(SITE).host.replace(/^www\./, '')

export function buildReport(lang: string, r: CheckEmailResult): { subject: string; html: string } {
  const it = lang === 'it'
  const recommended = r.level === 'recommended'
  const line = recommended
    ? (it ? `ChatGPT <b>consiglia già ${esc(r.brand)}</b> per “${esc(r.query)}”.` : `ChatGPT <b>already recommends ${esc(r.brand)}</b> for “${esc(r.query)}”.`)
    : r.level === 'known'
    ? (it ? `ChatGPT <b>conosce ${esc(r.brand)}</b> ma raramente lo consiglia per “${esc(r.query)}”: il tuo potenziale sull’AI è ancora limitato.` : `ChatGPT <b>knows ${esc(r.brand)}</b> but rarely recommends it for “${esc(r.query)}”: your AI potential is still limited.`)
    : (it ? `ChatGPT <b>non menziona ${esc(r.brand)}</b> per “${esc(r.query)}”: sei di fatto invisibile su questa ricerca AI.` : `ChatGPT <b>doesn’t mention ${esc(r.brand)}</b> for “${esc(r.query)}”: you’re effectively invisible for this AI search.`)
  const comps = (r.competitors || []).map((c: string) => esc(c)).join(' · ')
  // Only "instead" when the brand is not the one being recommended.
  const compTitle = recommended
    ? (it ? 'Consigliati insieme a te:' : 'Recommended alongside you:')
    : (it ? 'Chi consiglia invece:' : 'Who it recommends instead:')
  // "Fix it" makes no sense to someone ChatGPT already recommends.
  const cta = recommended
    ? (it ? 'Monitoralo e resta davanti — inizia gratis' : 'Track it and stay ahead — start free')
    : (it ? 'Risolvilo con Rankdelta — inizia gratis' : 'Fix it with Rankdelta — start free')
  const intro = it ? 'Ecco il tuo check di visibilità AI:' : 'Here is your AI-visibility check:'
  const subject = it ? `La tua visibilità su ChatGPT: ${r.brand}` : `Your ChatGPT visibility: ${r.brand}`
  const signup = it ? `${SITE}/it/signup` : `${SITE}/signup`
  const home = it ? `${SITE}/it` : SITE
  const why = it
    ? `Ricevi questa email perché hai richiesto un check gratuito su <a href='${home}' style='color:#a1a1aa;'>${SITE_HOST}</a>. Nessuna iscrizione: è un messaggio singolo.`
    : `You’re getting this because you requested a free check on <a href='${home}' style='color:#a1a1aa;'>${SITE_HOST}</a>. You’re not subscribed to anything: this is a one-off message.`
  const html = `<!doctype html><html lang='${it ? 'it' : 'en'}'><body style='margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'><div style='max-width:560px;margin:0 auto;padding:32px 24px;'><div style='font-weight:700;font-size:18px;color:#111;margin-bottom:24px;'>Rankdelta</div><div style='background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px;'><p style='color:#52525b;font-size:14px;margin:0 0 8px;'>${intro}</p><p style='color:#18181b;font-size:18px;line-height:1.5;margin:0 0 18px;'>${line}</p>${comps ? `<p style='color:#71717a;font-size:13px;margin:0 0 6px;'>${compTitle}</p><p style='color:#27272a;font-size:15px;margin:0 0 20px;'>${comps}</p>` : ''}<a href='${signup}' style='display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px;'>${cta}</a></div><p style='color:#a1a1aa;font-size:12px;line-height:1.5;margin:20px 0 0;text-align:center;'>${why}</p></div></body></html>`
  return { subject, html }
}
