import { db, json, serve } from '../_shared/util.ts';
const SIZE = 12;
serve(async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const page = Math.min(500, Math.max(0, parseInt(new URL(req.url).searchParams.get('page') ?? '0') || 0));
    const sb = db();
    const { data, error } = await sb.from('photos').select('id, storage_path, created_at').eq('status', 'approved')
      .order('created_at', { ascending: false }).range(page * SIZE, page * SIZE + SIZE); // one extra row = hasMore
    if (error) throw error;
    const rows = data.slice(0, SIZE), paths = rows.map((r) => r.storage_path), bucket = sb.storage.from('photos-quarantine');
    const view = rows.length ? (await bucket.createSignedUrls(paths, 3600)).data ?? [] : [];
    const dl = rows.length ? (await bucket.createSignedUrls(paths, 3600, { download: 'diwali-memory.jpg' })).data ?? [] : [];
    const items = rows.map((r, i) => ({ id: r.id, created_at: r.created_at, url: view[i]?.signedUrl, dl: dl[i]?.signedUrl })).filter((x) => x.url);
    return json({ items, hasMore: data.length > SIZE });
  } catch (_e) { console.error('gallery failed'); return json({ error: 'Could not load the gallery.' }, 500); }
});
