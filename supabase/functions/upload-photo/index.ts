
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { sniff, BAD_IMAGE } from '../_shared/image.ts';
import { db, json, serve, limited, sha, visitor } from '../_shared/util.ts';

const MAX = 10 * 1024 * 1024;

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const sb = db();

    if (await limited(sb, await visitor(req), 'upload', 5, 60)) {
      return json({ error: 'Too many uploads. Please try again later.' }, 429);
    }

    const form = await req.formData();

    if (form.get('website')) {
      return json({ error: 'Invalid submission.' }, 400);
    }

    if (form.get('consent') !== 'yes') {
      return json({ error: 'Please confirm you have permission to share this photo.' }, 400);
    }

    const f = form.get('photo');

    if (!(f instanceof File) || f.size < 1 || f.size > MAX) {
      return json({ error: 'Please choose a photo up to 10 MB.' }, 400);
    }

    const b = new Uint8Array(await f.arrayBuffer());

    if (!sniff(b)) {
      return json({ error: BAD_IMAGE }, 400);
    }

    let img: Image;

    try {
      img = await Image.decode(b);
    } catch {
      return json({ error: 'That image could not be read.' }, 400);
    }

    if (img.width * img.height > 40e6) {
      return json({ error: 'That image is too large.' }, 400);
    }

    if (Math.max(img.width, img.height) > 2000) {
      img = img.width >= img.height
        ? img.resize(2000, Image.RESIZE_AUTO)
        : img.resize(Image.RESIZE_AUTO, 2000);
    }

    const out = await img.encodeJPEG(85);
    const path = `${crypto.randomUUID()}.jpg`;

    const up = await sb.storage
      .from('photos-quarantine')
      .upload(path, out, { contentType: 'image/jpeg', upsert: false });

    if (up.error) throw up.error;

    const ins = await sb.from('photos').insert({
      storage_path: path,
      content_hash: await sha(out),
      bytes: out.length,
      status: 'approved'
    });

    if (ins.error) {
      await sb.storage.from('photos-quarantine').remove([path]);

      if (ins.error.code === '23505') {
        return json({ error: 'This photo has already been submitted.' }, 409);
      }

      throw ins.error;
    }

    await sb.rpc('increment_counter', { m: 'photo_submissions' });

    return json({ ok: true });

  } catch (e) {
    const err = e as {
      name?: string;
      message?: string;
      code?: string;
      statusCode?: string;
    };

    console.error('upload failed', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      statusCode: err?.statusCode
    });

    return json({ error: 'Upload failed. Please try again.' }, 500);
  }
});
