import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  canAccessModule,
  canAccessAdmin,
  canAccessCorteTpv,
  canAccessStaffCorte,
  canEditHrSchedules,
  isCorteTpvPath,
  isStaffCortePath,
  verifySessionToken,
} from '@/app/lib/auth';
import { homePathForModules } from '@/app/lib/modules';

const MODULE_PREFIXES = [
  '/staff',
  '/cortes',
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

  // PWA assets must stay public (Chrome fetches SW + manifest without session)
  if (
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/manifest.webmanifest/'
  ) {
    return NextResponse.next();
  }

  // Público: cotización /c/{token}, reservar mesa, APIs sin sesión
  if (
    pathname.startsWith('/c/') ||
    pathname.startsWith('/api/eventos/quotes/public/') ||
    pathname === '/reservar' ||
    pathname.startsWith('/reservar/') ||
    pathname.startsWith('/api/reservas') ||
    // Cron Vercel → Bearer CRON_SECRET (auth en la ruta)
    pathname === '/api/push/dispatch' ||
    pathname.startsWith('/api/push/dispatch/')
  ) {
    return NextResponse.next();
  }

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

  // Staff horario: consulta (módulo staff) o edición (rrhh / rrhh.schedules_edit)
  if (pathname === '/staff/horario' || pathname.startsWith('/staff/horario/')) {
    const ok =
      canAccessModule(session, 'staff') ||
      canEditHrSchedules(session) ||
      canAccessAdmin(session);
    if (!ok) {
      const home = homePathForModules(session.modules);
      return NextResponse.redirect(new URL(home, request.url));
    }
  } else if (isStaffCortePath(pathname)) {
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
    '/((?!_next/static|_next/image|favicon.ico|icons/|brand/|sw\\.js|offline\\.html|manifest\\.webmanifest).*)',
  ],
};
