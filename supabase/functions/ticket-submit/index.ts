import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { sniff, BAD_IMAGE } from '../_shared/image.ts';
import { db, json, serve, limited, sha, visitor } from '../_shared/util.ts';
import { newToken, validateTicket } from '../_shared/ticket.ts';
const MAXA = 3 * 1024 * 1024;
serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let path: string | null = null; const sb = db();
  try {
    if (await limited(sb, await visitor(req), 'ticket', 3, 60)) return json({ error: 'Too many tickets submitted. Please try again later.' }, 429);
    const form = await req.formData();
    if (form.get('website')) return json({ error: 'Invalid submission.' }, 400); // honeypot
    const v = validateTicket(Object.fromEntries(['name', 'email', 'category', 'title', 'description'].map((k) => [k, form.get(k)])));
    if (!v.value) return json({ error: v.error }, 400);
    const f = form.get('screenshot');
    if (f instanceof File && f.size > 0) {
      if (f.size > MAXA) return json({ error: 'The screenshot must be 3 MB or smaller.' }, 400);
      const b = new Uint8Array(await f.arrayBuffer());
      if (!sniff(b)) return json({ error: BAD_IMAGE }, 400);
      let img: Image; try { img = await Image.decode(b); } catch { return json({ error: 'The screenshot could not be read.' }, 400); }
      if (img.width * img.height > 40e6) return json({ error: 'The screenshot is too large.' }, 400);
      if (Math.max(img.width, img.height) > 2000) img = img.width >= img.height ? img.resize(2000, Image.RESIZE_AUTO) : img.resize(Image.RESIZE_AUTO, 2000);
      path = `${crypto.randomUUID()}.jpg`; // re-encoded: no EXIF, nothing appended
      const up = await sb.storage.from('ticket-attachments').upload(path, await img.encodeJPEG(85), { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
    }
    const { data: no, error: e1 } = await sb.rpc('next_ticket_no'); if (e1) throw e1;
    const token = newToken();
    const { error: e2 } = await sb.from('tickets').insert({ ...v.value, ticket_no: no, tracking_token_hash: await sha(token), attachment_path: path });
    if (e2) throw e2;
    await sb.rpc('increment_counter', { m: 'ticket_submissions' }); // aggregate total only
    return json({ ok: true, ticket_no: no, tracking_code: token }); // the code is shown once and never stored in plain text
  } catch (_e) {
    if (path) await sb.storage.from('ticket-attachments').remove([path]);
    console.error('ticket submit failed'); return json({ error: 'Could not submit your ticket. Please try again.' }, 500);
  }
});
