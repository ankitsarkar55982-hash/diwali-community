import { db, json, serve, limited, sha, visitor } from '../_shared/util.ts';
import { safeEqual, TICKET_NO } from '../_shared/ticket.ts';
serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const sb = db();
    if (await limited(sb, await visitor(req), 'ticket_lookup', 20, 60)) return json({ error: 'Too many lookups. Please try again later.' }, 429);
    let b: any; try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    const no = String(b?.ticket_no ?? '').trim().toUpperCase(), code = String(b?.tracking_code ?? '').trim();
    const NF = { error: 'Ticket not found, or the tracking code is incorrect.' };
    if (!TICKET_NO.test(no) || code.length < 20 || code.length > 64) return json(NF, 404);
    const { data: t } = await sb.from('tickets').select('tracking_token_hash, status, category, title, created_at, updated_at').eq('ticket_no', no).maybeSingle();
    if (!t || !safeEqual(t.tracking_token_hash, await sha(code))) return json(NF, 404); // same answer for "no such ticket" and "wrong code"
    return json({ ticket_no: no, status: t.status, category: t.category, title: t.title, created_at: t.created_at, updated_at: t.updated_at }); // no name, email, notes or attachment
  } catch (_e) { console.error('status failed'); return json({ error: 'Could not check the ticket.' }, 500); }
});
