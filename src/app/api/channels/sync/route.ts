import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "@/lib/api-auth";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  syncSumUpChannel, recordSyncError, SUMUP_CHANNEL_COLUMNS, type SumUpChannel,
} from "@/lib/channels/sumup";

export const runtime = "nodejs";
// One run fetches up to 150 sale details from SumUp.
export const maxDuration = 60;

/**
 * POST /api/channels/sync
 * body: { org_id }
 *
 * Pull new SumUp till sales into DishData now — the Channels page's
 * "Sync now" button and its background auto-sync. Any member may trigger it:
 * it only imports what SumUp already recorded. The channel row is read with
 * the service role because it carries the API key, which RLS keeps to
 * owner/admin and the browser never sees.
 */
export async function POST(req: NextRequest) {
  const auth = await authClient(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { org_id?: string };
  if (!body.org_id) return NextResponse.json({ error: "org_id is required." }, { status: 400 });

  const { data: member, error: memErr } = await auth.supabase.rpc("is_org_member", {
    _org: body.org_id,
  });
  if (memErr || !member) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  const { data: channel, error } = await admin
    .from("channels")
    .select(SUMUP_CHANNEL_COLUMNS)
    .eq("org_id", body.org_id)
    .eq("provider", "sumup")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!channel) return NextResponse.json({ error: "SumUp is not connected." }, { status: 404 });
  if (!channel.is_active) return NextResponse.json({ error: "SumUp sync is paused." }, { status: 409 });

  try {
    return NextResponse.json(await syncSumUpChannel(admin, channel as SumUpChannel));
  } catch (e) {
    const message = e instanceof Error ? e.message : "SumUp sync failed.";
    await recordSyncError(admin, channel.id, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
