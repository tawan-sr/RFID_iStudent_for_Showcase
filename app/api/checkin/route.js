import { checkIn, guard } from '../../../lib/store.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items.slice(0, 500) : [];
    const clean = items
      .filter((x) => x && x.key)
      .map((x) => ({ key: String(x.key), at: Number(x.at) || Date.now() }));
    const results = clean.length ? await checkIn(clean) : [];
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
