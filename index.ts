import { db, json, limited, serve, visitor } from '../_shared/util.ts';
// Privacy-friendly counters. The request body is ONLY {event}. Nothing else is read, logged or stored.
const MAP: Record<string, string> = { visit: 'visits', card_created: 'cards_created', share: 'shares' };
serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const metric = MAP[String(b?.event)];
  if (!metric) return json({ error: 'Bad request' }, 400);
  const sb = db();
  if (await limited(sb, await visitor(req), 'track', 120, 60)) return json({ ok: true }); // silently ignore floods so totals can't be inflated
  await sb.rpc('increment_counter', { m: metric });
  return json({ ok: true });
});
