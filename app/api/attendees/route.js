import { getAttendees, guard, MODE } from '../../../lib/store.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { attendees } = await getAttendees();
    return Response.json({
      mode: MODE,
      at: Date.now(),
      attendees: attendees.map(({ row, status, ...a }) => a),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
