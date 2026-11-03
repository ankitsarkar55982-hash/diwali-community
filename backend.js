/* Supabase integration: gallery, upload, reports, admin. Loads after the main script; a failure here never affects the intro or the rest of the site. */
(() => {
const C = window.APP_CONFIG || {};
const READY = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(C.SUPABASE_URL || '') && (C.SUPABASE_ANON_KEY || '').length > 20 && !/YOUR/.test(C.SUPABASE_ANON_KEY);
const NOCFG = 'The backend is not configured yet. Add your Supabase URL and key in config.js.';
// Anonymous counters: the request body is only {event}. Skipped entirely if the browser sends Do Not Track / Global Privacy Control.
window.track = ev => { try { if (!READY || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return; fetch(`${C.SUPABASE_URL}/functions/v1/track`, { method: 'POST', headers: { apikey: C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: ev }), keepalive: true }).catch(() => {}); } catch {} };
try { if (!sessionStorage.getItem('dv')) { sessionStorage.setItem('dv', '1'); track('visit'); } } catch {}
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(name, { method = 'GET', body, token, qs = '' } = {}) {
  const h = { apikey: C.SUPABASE_ANON_KEY };
  if (token) h.Authorization = 'Bearer ' + token;
  const isJson = body && !(body instanceof FormData);
  if (isJson) h['Content-Type'] = 'application/json';
  const r = await fetch(`${C.SUPABASE_URL}/functions/v1/${name}${qs}`, { method, headers: h, body: isJson ? JSON.stringify(body) : body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}

/* ---------- Gallery ---------- */
const G = {
  page: 0, busy: false, loaded: false,
  open() { if (!G.loaded) { G.loaded = true; G.load(true); } },
  async load(reset) {
    const box = $('#gal'), st = $('#gstate');
    if (!READY) { st.textContent = NOCFG; return; }
    if (G.busy) return; G.busy = true;
    if (reset) { G.page = 0; box.innerHTML = ''; }
    st.textContent = 'Loading…'; $('#gmore').hidden = true;
    try {
      const d = await call('gallery', { qs: '?page=' + G.page });
      box.insertAdjacentHTML('beforeend', d.items.map(i => `<figure class="ph"><img loading="lazy" decoding="async" alt="Diwali photo shared by the community" src="${esc(i.url)}"><figcaption class="pa"><a class="btn ghost" href="${esc(i.dl)}" download aria-label="Download photo">⬇<span class="lbl">&nbsp;Download</span></a><button class="ghost" data-sh aria-label="Share photo">⤴<span class="lbl">&nbsp;Share</span></button><button class="ghost" data-rp="${esc(i.id)}" aria-label="Report photo">⚑<span class="lbl">&nbsp;Report</span></button></figcaption></figure>`).join(''));
      st.textContent = box.children.length ? '' : 'No photos yet. Be the first to share a Diwali memory 🪔';
      $('#gmore').hidden = !d.hasMore; G.page++;
    } catch (e) { st.textContent = 'Could not load the gallery. ' + e.message; }
    G.busy = false;
  }
};
$('#grefresh').onclick = () => G.load(true);
$('#gmore').onclick = () => G.load(false);
let reportId = null;
$('#gal').addEventListener('click', async e => {
  const r = e.target.closest('[data-rp]'), s = e.target.closest('[data-sh]');
  if (r) { reportId = r.dataset.rp; $('#rdlg').showModal(); }
  if (s) {
    const u = location.origin + location.pathname + '#gallery';
    track('share');
    if (navigator.share) navigator.share({ title: 'Diwali memories', url: u }).catch(() => {});
    else try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast('Sharing is not available here'); }
  }
});
$('#rcancel').onclick = () => $('#rdlg').close();
$('#rsend').onclick = async () => {
  try { await call('report-photo', { method: 'POST', body: { photo_id: reportId, reason: $('#rreason').value, details: $('#rdetails').value } }); toast('Thank you. Our team will review this photo.'); $('#rdlg').close(); $('#rdetails').value = ''; }
  catch (e) { toast(e.message); }
};

/* ---------- Upload ---------- */
let blob = null;
const OKTYPES = ['image/jpeg', 'image/png', 'image/webp'], MAXB = 5 * 1024 * 1024;
async function prep(f) { // canvas re-encode: applies EXIF rotation and drops metadata before the file leaves the device (the server re-encodes again)
  const bmp = await createImageBitmap(f), s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('x')), 'image/jpeg', .85));
}
$('#pick').onchange = async e => {
  const f = e.target.files[0], st = $('#ups'); blob = null; $('#pv').hidden = true; st.textContent = '';
  if (!f) return;
  if (!OKTYPES.includes(f.type)) { st.textContent = 'Please choose a JPG, PNG or WebP photo.'; return; }
  if (f.size > MAXB) { st.textContent = 'That photo is larger than 5 MB.'; return; }
  try { blob = await prep(f); $('#pv').src = URL.createObjectURL(blob); $('#pv').hidden = false; }
  catch { st.textContent = 'That image could not be read.'; }
};
const send = (fd, onp) => new Promise((ok, no) => {
  const x = new XMLHttpRequest(); x.open('POST', C.SUPABASE_URL + '/functions/v1/upload-photo'); x.setRequestHeader('apikey', C.SUPABASE_ANON_KEY);
  x.upload.onprogress = ev => ev.lengthComputable && onp(ev.loaded / ev.total);
  x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? ok(j) : no(new Error(j.error || 'Upload failed. Please try again.')); };
  x.onerror = () => no(new Error('Network error. Please try again.')); x.send(fd);
});
$('#upf').onsubmit = async e => {
  e.preventDefault(); const st = $('#ups'), bar = $('#up');
  if (!READY) { st.textContent = NOCFG; return; }
  if (!blob) { st.textContent = 'Please choose a photo first.'; return; }
  if (!$('#consent').checked) { st.textContent = 'Please confirm you have permission to share this photo.'; return; }
  const fd = new FormData(); fd.append('photo', blob, 'photo.jpg'); fd.append('consent', 'yes'); fd.append('website', $('#hp').value);
  $('#upgo').disabled = true; bar.hidden = false; bar.value = 0; st.textContent = 'Uploading…';
  try { await send(fd, p => bar.value = p); st.textContent = 'Your beautiful Diwali memory has been submitted! Thank you for spreading happiness. It will appear in the gallery after review.'; $('#upf').reset(); $('#pv').hidden = true; blob = null; }
  catch (err) { st.textContent = err.message; }
  $('#upgo').disabled = false; bar.hidden = true;
};


/* ---------- Support tickets (visitor side). Never reads greeting-card fields. ---------- */
$('#tkf').onsubmit = async e => {
  e.preventDefault(); const st = $('#tks');
  if (!READY) { st.textContent = NOCFG; return; }
  st.textContent = 'Preparing…';
  const cat = $('#tkcat').value, title = $('#tktitle').value.trim(), desc = $('#tkdesc').value.trim(), mail = $('#tkemail').value.trim(), f = $('#tkfile').files[0];
  if (!cat) { st.textContent = 'Please choose a category.'; return; }
  if (title.length < 3) { st.textContent = 'Please enter a short title (at least 3 characters).'; return; }
  if (desc.length < 10) { st.textContent = 'Please describe the issue (at least 10 characters).'; return; }
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { st.textContent = 'That email address does not look right.'; return; }
  if (f && (!OKTYPES.includes(f.type) || f.size > 3 * 1024 * 1024)) { st.textContent = 'The screenshot must be a JPG, PNG or WebP image up to 3 MB.'; return; }
  let shot = null;
  if (f) { try { shot = await prep(f); } catch { st.textContent = 'The screenshot could not be read.'; return; } if (shot.size > 3 * 1024 * 1024) { st.textContent = 'The screenshot is still larger than 3 MB. Please use a smaller image.'; return; } }
  const fd = new FormData(); fd.append('category', cat); fd.append('title', title); fd.append('description', desc); fd.append('name', $('#tkname').value); fd.append('email', mail); fd.append('website', $('#tkhp').value);
  if (shot) fd.append('screenshot', shot, 'screenshot.jpg'); // WebP/PNG/JPEG are all re-encoded to JPEG in the browser; the server re-encodes again
  $('#tkgo').disabled = true; st.textContent = 'Submitting…';
  try {
    const r = await call('ticket-submit', { method: 'POST', body: fd });
    st.innerHTML = `Thank you! Your ticket has been submitted.<br>Ticket ID: <span class="idbox">${esc(r.ticket_no)}</span><br>Tracking code: <span class="idbox">${esc(r.tracking_code)}</span><br><small>Save both now. The tracking code is shown only once and is needed to check your ticket.</small>`;
    $('#trno').value = r.ticket_no; $('#trcode').value = r.tracking_code; $('#tkf').reset();
  } catch (err) { st.textContent = err.message; }
  $('#tkgo').disabled = false;
};
const SLBL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
$('#trf').onsubmit = async e => {
  e.preventDefault(); const st = $('#trs');
  if (!READY) { st.textContent = NOCFG; return; }
  st.textContent = 'Checking…';
  try {
    const r = await call('ticket-status', { method: 'POST', body: { ticket_no: $('#trno').value, tracking_code: $('#trcode').value } });
    st.innerHTML = `<b>${esc(SLBL[r.status] || r.status)}</b>: ${esc(r.title)}<br><small>Submitted ${esc(new Date(r.created_at).toLocaleString())} · Updated ${esc(new Date(r.updated_at).toLocaleString())}</small>`;
  } catch (err) { st.textContent = err.message; }
};

/* ---------- Admin ---------- */
const A = {
  sb: null, tab: 'pending',
  async open() {
    if (!READY) { $('#adst').textContent = NOCFG; return; }
    if (!A.sb) {
      await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }).catch(() => {});
      if (!window.supabase) { $('#adst').textContent = 'Could not load the sign-in library. Check your connection.'; return; }
      A.sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    }
    const { data } = await A.sb.auth.getSession(); A.show(!!data.session);
  },
  show(on) { $('#adlogin').hidden = on; $('#addash').hidden = !on; if (on) A.refresh(); },
  async api(action, extra = {}) {
    const { data } = await A.sb.auth.getSession();
    return call('admin', { method: 'POST', token: data.session?.access_token, body: { action, ...extra } });
  },
  async refresh() {
    const out = $('#adlist'); out.textContent = 'Loading…';
    try {
      const s = await A.api('stats');
      $('#adstats').textContent = `Pending ${s.pending} · Approved ${s.approved} · Rejected ${s.rejected} · Deleted ${s.deleted} · Open reports ${s.openReports} · Active tickets ${s.openTickets} · Uploads in last 24h ${s.last24h}`;
      const c = s.counters || {}; $('#adusage').textContent = `Usage totals (anonymous): visits ${c.visits ?? 0} · greeting cards created ${c.cards_created ?? 0} · shares ${c.shares ?? 0} · photo submissions ${c.photo_submissions ?? 0} · ticket submissions ${c.ticket_submissions ?? 0}`;
      document.querySelectorAll('#adtabs button').forEach(b => b.classList.toggle('sel', b.dataset.t === A.tab));
      if (A.tab === 'tickets') {
        out.innerHTML = '<div class="tkf"><input type="text" id="tq" placeholder="Search ticket ID"><select id="tcat"><option value="">All categories</option><option value="photo_upload">Photo upload</option><option value="gallery">Gallery</option><option value="greeting_card">Greeting card</option><option value="download_share">Download / share</option><option value="website_bug">Website bug</option><option value="other">Other</option></select><select id="tst"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><button class="ghost" id="tgo">Search</button></div><div id="tlist">Loading…</div>';
        A.tickets(); return;
      }
      if (A.tab === 'history') {
        const h = await A.api('history');
        out.innerHTML = h.logs.length ? '<table class="tbl"><tr><th>When</th><th>Action</th><th>From → to</th></tr>' + h.logs.map(l => `<tr><td data-label="When">${esc(new Date(l.created_at).toLocaleString())}</td><td data-label="Action">${esc(l.action)}</td><td data-label="Change">${esc(l.prev_status || '–')} → ${esc(l.new_status || '–')}</td></tr>`).join('') + '</table>' : 'No moderation actions yet.';
        return;
      }
      const d = await A.api('list', { status: A.tab });
      const btn = (a, id, t) => `<button class="ghost" data-act="${a}" data-id="${esc(id)}">${t}</button>`;
      out.innerHTML = d.photos.length ? '<div class="masonry adm">' + d.photos.map(p => `<figure class="ph"><img loading="lazy" alt="Submitted photo" src="${esc(p.url)}"><figcaption class="pa2"><small>${esc(new Date(p.created_at).toLocaleString())} · ${esc(p.status)}</small>${p.reports.map(r => `<small class="rep">⚑ ${esc(r.reason)}${r.details ? ': ' + esc(r.details) : ''}</small>`).join('')}<div class="pa">${p.status !== 'approved' ? btn('approved', p.id, 'Approve') : ''}${p.status !== 'rejected' ? btn('rejected', p.id, 'Reject') : ''}${btn('deleted', p.id, 'Delete')}${p.reports.length ? btn('dismiss', p.id, 'Dismiss reports') : ''}</div></figcaption></figure>`).join('') + '</div>' : 'Nothing here.';
    } catch (e) { out.textContent = e.message; if (/Forbidden|Unauthorized/.test(e.message)) A.out(); }
  },
  async tickets() {
    const box = $('#tlist');
    try {
      const d = await A.api('tickets_list', { q: $('#tq').value, category: $('#tcat').value, status: $('#tst').value });
      const op = (v, c) => `<option value="${v}"${v === c ? ' selected' : ''}>${SLBL[v]}</option>`;
      box.innerHTML = d.tickets.length ? d.tickets.map(t => `<div class="panel tk" data-id="${esc(t.id)}"><b>${esc(t.ticket_no)} · ${esc(t.title)}</b><small>${esc(t.category)} · by ${esc(t.name || 'anonymous')}${t.email ? ' · ' + esc(t.email) : ''} · created ${esc(new Date(t.created_at).toLocaleString())} · updated ${esc(new Date(t.updated_at).toLocaleString())}</small><div style="white-space:pre-wrap">${esc(t.description)}</div>${t.attachment_url ? `<a href="${esc(t.attachment_url)}" target="_blank" rel="noopener">View attachment</a>` : ''}<select data-f="status">${['open', 'in_progress', 'resolved', 'closed'].map(v => op(v, t.status)).join('')}</select><textarea data-f="notes" placeholder="Internal notes (never shown to the visitor)" maxlength="2000">${esc(t.admin_notes || '')}</textarea><div class="pa"><button class="ghost" data-tsave>Save</button><button class="ghost" data-tdel>Delete</button></div></div>`).join('') : 'No tickets match.';
    } catch (e) { box.textContent = e.message; }
  },
  async out() { await A.sb.auth.signOut(); A.show(false); }
};
$('#adlogin').onsubmit = async e => {
  e.preventDefault(); const st = $('#adst'); st.textContent = 'Signing in…';
  if (!A.sb) await A.open(); if (!A.sb) return;
  const { error } = await A.sb.auth.signInWithPassword({ email: $('#ademail').value.trim(), password: $('#adpass').value });
  $('#adpass').value = '';
  if (error) { st.textContent = 'Sign-in failed. Check your email and password.'; return; }
  try { await A.api('me'); st.textContent = ''; A.show(true); } catch { await A.out(); st.textContent = 'This account is not authorised as an administrator.'; }
};
$('#adout').onclick = () => A.out();
$('#adtabs').onclick = e => { const b = e.target.closest('button'); if (b) { A.tab = b.dataset.t; A.refresh(); } };
$('#adlist').onclick = async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'deleted' && !confirm('Permanently delete this photo?')) return;
  b.disabled = true;
  try { b.dataset.act === 'dismiss' ? await A.api('dismiss', { id: b.dataset.id }) : await A.api('moderate', { id: b.dataset.id, to: b.dataset.act }); toast('Done'); A.refresh(); }
  catch (err) { toast(err.message); b.disabled = false; }
};

$('#adlist').addEventListener('click', async e => {
  if (e.target.id === 'tgo') { A.tickets(); return; }
  const card = e.target.closest('.tk'); if (!card) return; const id = card.dataset.id;
  try {
    if (e.target.closest('[data-tsave]')) { await A.api('ticket_update', { id, status: card.querySelector('[data-f=status]').value, notes: card.querySelector('[data-f=notes]').value }); toast('Ticket saved'); A.tickets(); }
    if (e.target.closest('[data-tdel]') && confirm('Delete this ticket permanently?')) { await A.api('ticket_delete', { id }); toast('Ticket deleted'); A.tickets(); }
  } catch (err) { toast(err.message); }
});

window.Gallery = G; window.Admin = A;
dispatchEvent(new HashChangeEvent('hashchange')); // open the right view if the page loaded on #gallery or #admin
})();
