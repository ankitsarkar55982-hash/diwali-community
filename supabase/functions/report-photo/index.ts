import { db, json, serve, limited, UUID, visitor } from '../_shared/util.ts';
const REASONS = ['inappropriate', 'privacy', 'copyright', 'spam', 'other'];
serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const sb = db(), key = await visitor(req);
    let b: any; try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    if (!UUID.test(b?.photo_id ?? '') || !REASONS.includes(b?.reason)) return json({ error: 'Please choose a reason.' }, 400);
    const details = typeof b.details === 'string' ? b.details.trim().slice(0, 300) : null;
    if (await limited(sb, key, 'report', 10, 60)) return json({ error: 'Too many reports. Please try again later.' }, 429);
    const { data: p } = await sb.from('photos').select('id').eq('id', b.photo_id).eq('status', 'approved').maybeSingle();
    if (!p) return json({ error: 'Photo not found.' }, 404);
    const { error } = await sb.from('photo_reports').insert({ photo_id: b.photo_id, reason: b.reason, details: details || null, reporter_hash: key });
    if (error?.code === '23505') return json({ error: 'You have already reported this photo.' }, 409);
    if (error) throw error;
    return json({ ok: true });
  } catch (_e) { console.error('report failed'); return json({ error: 'Could not send the report.' }, 500); }
});
