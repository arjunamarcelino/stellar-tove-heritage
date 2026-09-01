import { z } from 'zod/v4';
import { readAccessToken } from '@/lib/cookies';
import { getMyTrade } from '@/lib/services/accept';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';
import type { MyTradeResult } from '@/lib/types/api';

// GET route handler for the settlement poll (TOV-178 / FR-06.04). The recurring `accept/me` read moved OFF a
// Server Action onto this handler (todo 177): Next 16 dispatches Server Actions one-at-a-time over POST, so a
// ~3–20s poll could queue behind the accept mutation; a GET route handler is the idiomatic transport for a
// repeating read (concurrent, AbortController-cancellable client-side). Reads the httpOnly cookie server-side
// (never a client-passed token); returns the same MyTradeResult shape the client already consumes. `params` is
// a Promise in Next 16.

const uuidSchema = z.uuid();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ rfqId: string }> },
): Promise<Response> {
  const { rfqId } = await params;
  const token = await readAccessToken();
  if (!token) {
    return json({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: ACCEPT_MESSAGES.SESSION_EXPIRED,
    });
  }
  if (!uuidSchema.safeParse(rfqId).success) {
    return json({ status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR });
  }
  return json(await getMyTrade(token, rfqId));
}

function json(result: MyTradeResult): Response {
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
