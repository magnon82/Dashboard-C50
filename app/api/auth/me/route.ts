import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  canAccessStaffCorte,
} from '@/app/lib/auth';

export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      username: session.username,
      role: session.role,
      modules: session.modules,
      capabilities: session.capabilities,
      canEdit: session.canEdit,
      canAccessAdmin: canAccessAdmin(session),
      canAccessStaffCorte: canAccessStaffCorte(session),
    },
  });
}
