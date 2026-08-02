import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  canAccessModule,
  canAccessAdmin,
  canAccessCorteTpv,
  canAccessStaffCorte,
  isCorteTpvPath,
  isStaffCortePath,
  verifySessionToken,
} from '@/app/lib/auth';
import { homePathForModules } from '@/app/lib/modules';

const MODULE_PREFIXES = [
  '/staff',
  '/ventas',
  '/finanzas',
  '/rrhh',
  '/eventos',
  '/reportes-socios',
  '/cocina',
  '/barra',
  '/calidad',
  '/inventarios',
] as const;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    if (pathname.startsWith('/login')) {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      const session = token ? await verifySessionToken(token) : null;
      if (session) {
        const home = homePathForModules(session.modules);
        return NextResponse.redirect(new URL(home, request.url));
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Single-module users skip the hub
  if (pathname === '/') {
    const home = homePathForModules(session.modules);
    if (home !== '/') {
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (!canAccessAdmin(session)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Solo el administrador puede gestionar usuarios' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Staff Corte: requiere palomita staff.corte (además de módulo staff)
  if (isStaffCortePath(pathname)) {
    if (!canAccessModule(session, 'staff') && !canAccessAdmin(session)) {
      const home = homePathForModules(session.modules);
      return NextResponse.redirect(new URL(home, request.url));
    }
    if (!canAccessStaffCorte(session)) {
      return NextResponse.redirect(new URL('/staff', request.url));
    }
  } else if (isCorteTpvPath(pathname)) {
    // Cortes TPV (Ventas): capability staff.corte o módulo Ventas / admin
    if (!canAccessCorteTpv(session)) {
      const home = homePathForModules(session.modules);
      return NextResponse.redirect(new URL(home, request.url));
    }
  } else {
    for (const prefix of MODULE_PREFIXES) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        const moduleId = prefix.slice(1);
        if (!canAccessModule(session, moduleId)) {
          const home = homePathForModules(session.modules);
          return NextResponse.redirect(new URL(home, request.url));
        }
        break;
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|brand/).*)',
  ],
};
