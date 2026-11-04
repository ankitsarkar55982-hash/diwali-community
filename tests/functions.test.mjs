// Runs the REAL Edge Function source files with Deno.serve captured and the Supabase client replaced by an in-memory fake.
// This verifies each function's own logic (validation, auth, CORS, rate limits, responses). It does NOT test Supabase itself.
import { register } from 'node:module';
register('./fn_hooks.mjs', import.meta.url);
let fails = 0, n = 0; const t = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', IP_SALT: 'a-long-random-salt-value-1234567890', ALLOWED_ORIGIN: 'https://site.example.com' };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { globalThis.__handler = h; } };
const root = new URL('../supabase/functions/', import.meta.url).href;
let seq = 0; const load = async (name) => { await import(root + name + '/index.ts?i=' + (seq++)); return globalThis.__handler; };

// in-memory fake: `rules(table, ops)` decides the result of each query; rpc/log are recorded
function fake(rules, extra = {}) {
  const log = { rpc: [], ops: [], removed: [], uploaded: [] };
  const builder = (table) => { const ops = []; const b = new Proxy(function () {}, { get: (_, p) => p === 'then' ? (ok, no) => { log.ops.push([table, ops.map((o) => o[0])]); return Promise.resolve(rules(table, ops, log)).then(ok, no); } : (...a) => { ops.push([p, a]); return b; } }); return b; };
  globalThis.__fakeClient = () => ({
    from: builder,
    rpc: (name, a) => { log.rpc.push([name, a]); return Promise.resolve(extra.rpc ? extra.rpc(name, a) : { data: 'DIWALI-2026-0007', error: null }); },
    storage: { from: () => ({ createSignedUrls: async (p, e, o) => ({ data: p.map((x) => ({ signedUrl: 'https://signed/' + x + (o ? '?dl' : '') })) }), remove: async (p) => { log.removed.push(p); return {}; }, upload: async (p) => { log.uploaded.push(p); return {}; } }) },
    auth: { getUser: async (tok) => ({ data: { user: tok === 'admintok' ? { id: 'u-admin' } : tok === 'usertok' ? { id: 'u-user' } : null } }) },
  });
  return log;
}
const allowOK = (table, ops) => table === 'rate_limits' ? { count: 0, error: null } : { data: null, error: null };
const req = (name, { method = 'POST', body, headers = {}, origin = 'https://site.example.com', form } = {}) =>
  new Request('https://x.supabase.co/functions/v1/' + name, { method, headers: { ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: form ?? (body ? JSON.stringify(body) : undefined) });
const J = async (r) => ({ s: r.status, j: await r.json().catch(() => null), h: r.headers });
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---------- shared behaviour (CORS, preflight, config) via track ----------
{ const log = fake(allowOK); const h = await load('track');
  const pre = await h(req('track', { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } })); t('preflight from allowed origin: 204 + Allow-Origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://site.example.com');
  const bad = await J(await h(req('track', { method: 'POST', body: { event: 'visit' }, origin: 'https://evil.example' }))); t('track: other website origin gets 403', bad.s === 403 && log.rpc.length === 0, bad);
  const ok = await J(await h(req('track', { body: { event: 'visit' } }))); t('track: visit increments `visits` once', ok.s === 200 && JSON.stringify(log.rpc) === '[["increment_counter",{"m":"visits"}]]', log.rpc);
  await h(req('track', { body: { event: 'card_created' } })); await h(req('track', { body: { event: 'share' } }));
  t('track: card_created/share map to cards_created/shares', log.rpc.map((r) => r[1].m).join() === 'visits,cards_created,shares');
  const unk = await J(await h(req('track', { body: { event: 'name=Priya' } }))); t('track: unknown event rejected, nothing counted', unk.s === 400 && log.rpc.length === 3);
  const extra = await h(req('track', { body: { event: 'share', name: 'ZzRecipientQ', message: 'ZzMessageQ' } })); t('track: extra fields are ignored and never stored', extra.status === 200 && !JSON.stringify([log.rpc, log.ops]).includes('ZzRecipientQ'));
  const get = await J(await h(req('track', { method: 'GET' }))); t('track: GET refused', get.s === 405);
  delete env.IP_SALT; const noSalt = await J(await h(req('track', { body: { event: 'visit' } }))); t('missing IP_SALT fails closed (500, no counter change)', noSalt.s === 500 && log.rpc.length === 4, noSalt); env.IP_SALT = 'a-long-random-salt-value-1234567890';
  const flood = fake((tb) => tb === 'rate_limits' ? { count: 999 } : { error: null }); const h2 = await load('track'); const fl = await J(await h2(req('track', { body: { event: 'visit' } }))); t('track: over rate limit is silently ignored (not counted)', fl.s === 200 && flood.rpc.length === 0); }

// ---------- ticket-submit ----------
const tform = (o = {}, file) => { const f = new FormData(); for (const [k, v] of Object.entries({ category: 'gallery', title: 'Gallery is slow', description: 'The gallery takes ages to load on my phone.', name: '', email: '', ...o })) f.append(k, v); if (file) f.append('screenshot', file, 'shot.jpg'); return f; };
{ let inserted; const log = fake((tb, ops) => { if (tb === 'tickets') inserted = ops.find((o) => o[0] === 'insert')[1][0]; return allowOK(tb); }); const h = await load('ticket-submit');
  const r = await J(await h(req('ticket-submit', { form: tform() }))); t('ticket-submit: valid ticket → ID + tracking code', r.s === 200 && /^DIWALI-\d{4}-\d{4}$/.test(r.j.ticket_no) && r.j.tracking_code.length >= 30, r);
  t('ticket-submit: only the HASH of the code is stored', inserted && inserted.tracking_token_hash === await sha(r.j.tracking_code) && !JSON.stringify(inserted).includes(r.j.tracking_code));
  t('ticket-submit: counter incremented server-side', log.rpc.some((x) => x[0] === 'increment_counter' && x[1].m === 'ticket_submissions'));
  t('ticket-submit: row has no greeting fields', !Object.keys(inserted).some((k) => /greeting|recipient|sender|message/i.test(k)), Object.keys(inserted));
  for (const [label, o] of [['bad category', { category: 'x' }], ['short title', { title: 'a' }], ['short description', { description: 'short' }], ['bad email', { email: 'nope' }]]) { const x = await J(await h(req('ticket-submit', { form: tform(o) }))); t('ticket-submit: ' + label + ' → 400', x.s === 400, x); }
  const hp = await J(await h(req('ticket-submit', { form: tform({ website: 'bot' }) }))); t('ticket-submit: honeypot filled → 400', hp.s === 400);
  const gif = await J(await h(req('ticket-submit', { form: tform({}, new File([new TextEncoder().encode('GIF89a....')], 'a.gif', { type: 'image/gif' })) }))); t('ticket-submit: GIF/WebP bytes refused by magic bytes (even if labelled image/jpeg)', gif.s === 400 && /JPG, PNG or WebP/.test(gif.j.error), gif);
  const big = await J(await h(req('ticket-submit', { form: tform({}, new File([new Uint8Array(3 * 1024 * 1024 + 1)], 's.jpg', { type: 'image/jpeg' })) }))); t('ticket-submit: screenshot over 3 MB → 400', big.s === 400);
  log.uploaded.length = 0; const jpg = await J(await h(req('ticket-submit', { form: tform({}, new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])], 's.jpg', { type: 'image/jpeg' })) }))); t('ticket-submit: JPEG screenshot accepted, stored as new random .jpg', jpg.s === 200 && log.uploaded.length === 1 && /^[0-9a-f-]{36}\.jpg$/.test(log.uploaded[0]), log.uploaded);
  const png = await J(await h(req('ticket-submit', { form: tform({}, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])], 's.png', { type: 'image/png' })) }))); t('ticket-submit: PNG screenshot accepted', png.s === 200);
  globalThis.__decodeFail = true; const cor = await J(await h(req('ticket-submit', { form: tform({}, new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], 's.jpg', { type: 'image/jpeg' })) }))); t('ticket-submit: undecodable image → 400, no ticket', cor.s === 400); globalThis.__decodeFail = false;
  const lim = fake((tb) => tb === 'rate_limits' ? { count: 3 } : { error: null }); const h2 = await load('ticket-submit'); const x = await J(await h2(req('ticket-submit', { form: tform() }))); t('ticket-submit: 4th ticket in an hour → 429', x.s === 429 && lim.rpc.length === 0, x); }

// ---------- ticket-status ----------
{ const code = 'tracking-code-' + 'x'.repeat(20), hash = await sha(code);
  fake((tb, ops) => tb === 'tickets' ? { data: { tracking_token_hash: hash, status: 'in_progress', category: 'gallery', title: 'T', created_at: 'c', updated_at: 'u', admin_notes: 'SECRET', email: 'a@b.co', name: 'N' }, error: null } : allowOK(tb));
  const h = await load('ticket-status'); const body = (o) => ({ body: { ticket_no: 'DIWALI-2026-0007', tracking_code: code, ...o } });
  const ok = await J(await h(req('ticket-status', body({})))); t('ticket-status: correct ID + code → status only', ok.s === 200 && ok.j.status === 'in_progress' && !('admin_notes' in ok.j) && !('email' in ok.j) && !('name' in ok.j) && !JSON.stringify(ok.j).includes('SECRET'), ok);
  const wrong = await J(await h(req('ticket-status', body({ tracking_code: 'wrong-code-' + 'y'.repeat(20) })))); const none = await J(await h(req('ticket-status', body({ ticket_no: 'nonsense' }))));
  t('ticket-status: wrong code → 404 with the same message as unknown ticket', wrong.s === 404 && none.s === 404 && wrong.j.error === none.j.error);
  const nocode = await J(await h(req('ticket-status', body({ tracking_code: '' })))); t('ticket-status: ID alone (no code) refused', nocode.s === 404); }

// ---------- report-photo ----------
{ const PID = '11111111-1111-4111-8111-111111111111'; let dup = false;
  const log = fake((tb, ops) => tb === 'photos' ? { data: { id: PID }, error: null } : tb === 'photo_reports' ? { error: dup ? { code: '23505' } : null } : allowOK(tb)); const h = await load('report-photo');
  const ok = await J(await h(req('report-photo', { body: { photo_id: PID, reason: 'spam' } }))); t('report-photo: valid report stored', ok.s === 200 && log.ops.some((o) => o[0] === 'photo_reports' && o[1].includes('insert')));
  t('report-photo: bad reason → 400', (await J(await h(req('report-photo', { body: { photo_id: PID, reason: 'xx' } })))).s === 400);
  t('report-photo: bad photo id → 400', (await J(await h(req('report-photo', { body: { photo_id: '1 or 1=1', reason: 'spam' } })))).s === 400);
  dup = true; t('report-photo: duplicate report → 409', (await J(await h(req('report-photo', { body: { photo_id: PID, reason: 'spam' } })))).s === 409);
  fake((tb) => tb === 'photos' ? { data: null, error: null } : allowOK(tb)); const h2 = await load('report-photo'); t('report-photo: photo not approved/not found → 404', (await J(await h2(req('report-photo', { body: { photo_id: PID, reason: 'spam' } })))).s === 404); }

// ---------- gallery ----------
{ const rows = Array.from({ length: 13 }, (_, i) => ({ id: 'id' + i, storage_path: `p${i}.jpg`, created_at: 'c' })); let filter = [];
  fake((tb, ops) => { if (tb === 'photos') { filter = ops.filter((o) => o[0] === 'eq').map((o) => o[1]); return { data: rows, error: null }; } return allowOK(tb); }); const h = await load('gallery');
  const r = await J(await h(req('gallery', { method: 'GET' }))); t('gallery: only approved photos are queried', JSON.stringify(filter) === '[["status","approved"]]', filter);
  t('gallery: 12 items + hasMore, signed URLs for view and download, no storage paths', r.s === 200 && r.j.items.length === 12 && r.j.hasMore === true && r.j.items[0].url.startsWith('https://signed/') && r.j.items[0].dl.endsWith('?dl') && !JSON.stringify(r.j).includes('storage_path'), r.j.items?.[0]);
  t('gallery: no uploader fields in the response', !/name|email|ip|user/i.test(Object.keys(r.j.items[0]).join())); }

// ---------- upload-photo ----------
{ const log = fake((tb) => allowOK(tb)); const h = await load('upload-photo');
  const form = (o = {}, file) => { const f = new FormData(); f.append('consent', o.consent ?? 'yes'); if (o.website) f.append('website', o.website); if (file !== null) f.append('photo', file ?? new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5])], 'p.jpg', { type: 'image/jpeg' })); return f; };
  const ok = await J(await h(req('upload-photo', { form: form() }))); t('upload-photo: valid photo stored as pending in private bucket', ok.s === 200 && log.uploaded.length === 1 && log.ops.some((o) => o[0] === 'photos' && o[1].includes('insert')), ok);
  t('upload-photo: photo counter incremented', log.rpc.some((x) => x[1].m === 'photo_submissions'));
  t('upload-photo: no consent → 400', (await J(await h(req('upload-photo', { form: form({ consent: 'no' }) })))).s === 400);
  t('upload-photo: honeypot → 400', (await J(await h(req('upload-photo', { form: form({ website: 'x' }) })))).s === 400);
  t('upload-photo: no file → 400', (await J(await h(req('upload-photo', { form: form({}, null) })))).s === 400);
  t('upload-photo: over 5 MB → 400', (await J(await h(req('upload-photo', { form: form({}, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'b.jpg', { type: 'image/jpeg' })) })))).s === 400);
  const fake1 = await J(await h(req('upload-photo', { form: form({}, new File([new TextEncoder().encode('<script>alert(1)</script>')], 'x.jpg', { type: 'image/jpeg' })) }))); t('upload-photo: HTML renamed .jpg refused by magic bytes', fake1.s === 400, fake1);
  const dupl = fake((tb) => tb === 'photos' ? { error: { code: '23505' } } : allowOK(tb)); const h2 = await load('upload-photo'); const d = await J(await h2(req('upload-photo', { form: form() }))); t('upload-photo: duplicate photo → 409 and orphan file removed', d.s === 409 && dupl.removed.length === 1, d); }

// ---------- admin ----------
{ const PID = '11111111-1111-4111-8111-111111111111';
  const log = fake((tb, ops) => tb === 'admin_users' ? { data: ops.some((o) => o[0] === 'eq' && o[1][1] === 'u-admin') ? { user_id: 'u-admin' } : null } : tb === 'photos' ? { data: { status: 'pending', storage_path: 'p.jpg' }, count: 2, error: null } : tb === 'site_counters' ? { data: [{ metric: 'visits', total: 5 }] } : tb === 'tickets' ? { data: [{ id: PID, ticket_no: 'DIWALI-2026-0001', attachment_path: null }], count: 1 } : { data: [], count: 0, error: null });
  const h = await load('admin'); const call = (tok, body) => J(h(req('admin', { body, headers: tok ? { authorization: 'Bearer ' + tok } : {} })).then ? undefined : undefined);
  const A = async (tok, body) => J(await h(req('admin', { body, headers: tok ? { authorization: 'Bearer ' + tok } : {} })));
  t('admin: no token → 401', (await A(null, { action: 'me' })).s === 401);
  t('admin: garbage token → 401', (await A('nope', { action: 'me' })).s === 401);
  t('admin: signed-in NON-admin → 403 for every action', (await Promise.all(['me', 'stats', 'list', 'moderate', 'tickets_list', 'ticket_update', 'ticket_delete', 'history'].map((a) => A('usertok', { action: a, status: 'pending', id: PID, to: 'approved' })))).every((r) => r.s === 403));
  t('admin: admin → me OK', (await A('admintok', { action: 'me' })).s === 200);
  const st = await A('admintok', { action: 'stats' }); t('admin: stats are aggregate counters + counts only', st.s === 200 && st.j.counters.visits === 5 && !JSON.stringify(st.j).match(/message|recipient|sender|greeting/i), st);
  t('admin: moderate with bad status → 400', (await A('admintok', { action: 'moderate', id: PID, to: 'pending' })).s === 400);
  t('admin: moderate with bad id → 400', (await A('admintok', { action: 'moderate', id: 'x', to: 'approved' })).s === 400);
  log.removed.length = 0; t('admin: delete removes the stored file and logs it', (await A('admintok', { action: 'moderate', id: PID, to: 'deleted' })).s === 200 && log.removed.length === 1 && log.ops.some((o) => o[0] === 'moderation_logs'));
  t('admin: approve is logged', (await A('admintok', { action: 'moderate', id: PID, to: 'approved' })).s === 200);
  t('admin: ticket_update with bad status → 400', (await A('admintok', { action: 'ticket_update', id: PID, status: 'bogus' })).s === 400);
  t('admin: ticket_update status+notes OK', (await A('admintok', { action: 'ticket_update', id: PID, status: 'resolved', notes: 'done' })).s === 200);
  t('admin: tickets_list OK', (await A('admintok', { action: 'tickets_list', q: "x'; drop table", category: 'gallery', status: 'open' })).s === 200);
  t('admin: ticket_delete OK', (await A('admintok', { action: 'ticket_delete', id: PID })).s === 200);
  t('admin: unknown action → 400', (await A('admintok', { action: 'rm -rf' })).s === 400); }

console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
