import { db, json, serve, UUID } from '../_shared/util.ts';
import { CATEGORIES, STATUSES } from '../_shared/ticket.ts';
serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const sb = db();
  const { data: u } = await sb.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  const uid = u?.user?.id;
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  const { data: adm } = await sb.from('admin_users').select('user_id').eq('user_id', uid).maybeSingle();
  if (!adm) return json({ error: 'Forbidden' }, 403); // every action below is admin-only
  let b: any; try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  try {
    const bucket = sb.storage.from('photos-quarantine');
    const log = (photo_id: string, action: string, prev_status: string | null, new_status: string | null) =>
      sb.from('moderation_logs').insert({ photo_id, admin_id: uid, action, prev_status, new_status });
    switch (b.action) {
      case 'me': return json({ ok: true });
      case 'stats': {
        const n = async (s: string) => (await sb.from('photos').select('*', { count: 'exact', head: true }).eq('status', s)).count ?? 0;
        const open = (await sb.from('photo_reports').select('*', { count: 'exact', head: true }).eq('resolved', false)).count ?? 0;
        const day = (await sb.from('photos').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 864e5).toISOString())).count ?? 0;
        const { data: cs } = await sb.from('site_counters').select('metric, total');
        return json({ counters: Object.fromEntries((cs ?? []).map((c) => [c.metric, c.total])), pending: await n('pending'), approved: await n('approved'), rejected: await n('rejected'), deleted: await n('deleted'), openReports: open, last24h: day, openTickets: (await sb.from('tickets').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])).count ?? 0 });
      }
      case 'list': {
        let q = sb.from('photos').select('id, storage_path, status, created_at').order('created_at', { ascending: false }).limit(60);
        if (b.status === 'reported') {
          const { data: r } = await sb.from('photo_reports').select('photo_id').eq('resolved', false);
          q = q.in('id', [...new Set((r ?? []).map((x) => x.photo_id))]).neq('status', 'deleted');
        } else if (['pending', 'approved', 'rejected'].includes(b.status)) q = q.eq('status', b.status);
        else return json({ error: 'Bad request' }, 400);
        const { data: ph } = await q;
        const rows = ph ?? [], ids = rows.map((p) => p.id);
        const { data: reps } = ids.length ? await sb.from('photo_reports').select('photo_id, reason, details, created_at').eq('resolved', false).in('photo_id', ids) : { data: [] };
        const urls = rows.length ? (await bucket.createSignedUrls(rows.map((p) => p.storage_path), 900)).data ?? [] : [];
        return json({ photos: rows.map((p, i) => ({ id: p.id, status: p.status, created_at: p.created_at, url: urls[i]?.signedUrl, reports: (reps ?? []).filter((r) => r.photo_id === p.id) })) });
      }
      case 'moderate': {
        if (!UUID.test(b.id ?? '') || !['approved', 'rejected', 'deleted'].includes(b.to)) return json({ error: 'Bad request' }, 400);
        const { data: p } = await sb.from('photos').select('status, storage_path').eq('id', b.id).maybeSingle();
        if (!p || p.status === 'deleted') return json({ error: 'Photo not found' }, 404);
        await sb.from('photos').update({ status: b.to, moderated_at: new Date().toISOString(), moderated_by: uid }).eq('id', b.id);
        if (b.to === 'deleted') await bucket.remove([p.storage_path]);
        if (b.to !== 'approved') await sb.from('photo_reports').update({ resolved: true }).eq('photo_id', b.id);
        await log(b.id, b.to, p.status, b.to);
        return json({ ok: true });
      }
      case 'dismiss': {
        if (!UUID.test(b.id ?? '')) return json({ error: 'Bad request' }, 400);
        await sb.from('photo_reports').update({ resolved: true }).eq('photo_id', b.id);
        await log(b.id, 'dismiss_reports', null, null);
        return json({ ok: true });
      }
      case 'history': {
        const { data } = await sb.from('moderation_logs').select('photo_id, action, prev_status, new_status, created_at').order('created_at', { ascending: false }).limit(50);
        return json({ logs: data ?? [] });
      }
      case 'tickets_list': {
        let q = sb.from('tickets').select('id, ticket_no, name, email, category, title, description, status, attachment_path, admin_notes, created_at, updated_at').order('created_at', { ascending: false }).limit(100);
        if (STATUSES.includes(b.status)) q = q.eq('status', b.status);
        if (CATEGORIES.includes(b.category)) q = q.eq('category', b.category);
        const term = String(b.q ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
        if (term) q = q.ilike('ticket_no', `%${term}%`);
        const { data } = await q; const rows = data ?? [];
        const withFile = rows.filter((t) => t.attachment_path);
        const urls = withFile.length ? (await sb.storage.from('ticket-attachments').createSignedUrls(withFile.map((t) => t.attachment_path), 900)).data ?? [] : [];
        return json({ tickets: rows.map((t) => ({ ...t, attachment_path: undefined, attachment_url: withFile.includes(t) ? urls[withFile.indexOf(t)]?.signedUrl : null })) });
      }
      case 'ticket_update': {
        if (!UUID.test(b.id ?? '')) return json({ error: 'Bad request' }, 400);
        const patch: Record<string, unknown> = {};
        if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return json({ error: 'Bad request' }, 400); patch.status = b.status; }
        if (b.notes !== undefined) patch.admin_notes = String(b.notes).slice(0, 2000);
        if (!Object.keys(patch).length) return json({ error: 'Bad request' }, 400);
        const { error } = await sb.from('tickets').update(patch).eq('id', b.id); if (error) throw error;
        return json({ ok: true });
      }
      case 'ticket_delete': {
        if (!UUID.test(b.id ?? '')) return json({ error: 'Bad request' }, 400);
        const { data: t } = await sb.from('tickets').select('attachment_path').eq('id', b.id).maybeSingle();
        if (t?.attachment_path) await sb.storage.from('ticket-attachments').remove([t.attachment_path]);
        await sb.from('tickets').delete().eq('id', b.id);
        return json({ ok: true });
      }
      default: return json({ error: 'Bad request' }, 400);
    }
  } catch (_e) { console.error('admin failed'); return json({ error: 'Server error' }, 500); }
});
