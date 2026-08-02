import { NextResponse } from 'next/server';
import { hashPassword } from '@/app/lib/password';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhEmployeesWrite,
} from '@/app/lib/hr-api';
import {
  passwordFromFechaIngreso,
  sanitizeSuiteUsername,
  suggestSuiteUsername,
} from '@/app/lib/hr-suite-user';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  createUser,
  findUserByUsername,
  getServiceSupabase,
  updateUser,
} from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/hr/employees/suite-user
 * Crea usuario Suite (módulo staff) + vincula hr_employees.suite_username.
 * Contraseña inicial = DDMM de fecha_ingreso (ej. 2023-01-12 → 1201).
 * No regenera cuentas existentes (roman/roberto u otros): solo vincula.
 *
 * Body: { employeeId, username? } | { employeeId, action: 'reset_password' }
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;

  let body: {
    employeeId?: string;
    username?: string;
    action?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const employeeId = String(body.employeeId || '').trim();
  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: emp, error: empErr } = await sb
      .from('hr_employees')
      .select('id, full_name, fecha_ingreso, suite_username, status, email')
      .eq('id', employeeId)
      .maybeSingle();

    if (empErr) {
      const missing = hrSchemaMissing(empErr.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : empErr.message,
        },
        { status: missing ? 503 : 500 }
      );
    }
    if (!emp) {
      return NextResponse.json(
        { error: 'Colaborador no encontrado' },
        { status: 404 }
      );
    }

    const displayName = formatHrListName(String(emp.full_name || ''));

    if (body.action === 'reset_password') {
      const linked = String(emp.suite_username || '')
        .trim()
        .toLowerCase();
      if (!linked) {
        return NextResponse.json(
          { error: 'Este colaborador aún no tiene usuario Suite' },
          { status: 400 }
        );
      }
      const initial = passwordFromFechaIngreso(
        emp.fecha_ingreso ? String(emp.fecha_ingreso).slice(0, 10) : null
      );
      if (!initial) {
        return NextResponse.json(
          {
            error:
              'Define fecha de ingreso antes de restablecer (contraseña = DDMM de ingreso).',
          },
          { status: 400 }
        );
      }
      const existing = await findUserByUsername(linked);
      if (!existing) {
        return NextResponse.json(
          {
            error: `Usuario «${linked}» no existe en Suite. Crea el usuario o corrige el vínculo.`,
          },
          { status: 404 }
        );
      }
      const updated = await updateUser(existing.id, {
        passwordHash: hashPassword(initial),
        password: initial,
      });
      return NextResponse.json({
        ok: true,
        linked: true,
        created: false,
        reset: true,
        username: updated.username,
        password: initial,
        displayName: updated.display_name || displayName,
        message: `Contraseña restablecida a día+mes de ingreso (${initial}).`,
      });
    }

    const existingLink = String(emp.suite_username || '')
      .trim()
      .toLowerCase();
    if (existingLink) {
      const existing = await findUserByUsername(existingLink);
      return NextResponse.json({
        ok: true,
        linked: true,
        created: false,
        alreadyHadUser: true,
        username: existingLink,
        password: existing?.password ?? null,
        displayName: existing?.display_name || displayName,
        message: `Ya tiene usuario: ${existingLink}`,
      });
    }

    let username = sanitizeSuiteUsername(
      body.username?.trim()
        ? body.username
        : suggestSuiteUsername(String(emp.full_name || ''))
    );
    if (!username || username.length < 2) {
      return NextResponse.json(
        { error: 'Usuario inválido (mín. 2 caracteres)' },
        { status: 400 }
      );
    }

    const initial = passwordFromFechaIngreso(
      emp.fecha_ingreso ? String(emp.fecha_ingreso).slice(0, 10) : null
    );
    if (!initial) {
      return NextResponse.json(
        {
          error:
            'Define fecha de ingreso antes de crear el usuario. Contraseña inicial = día+mes (DDMM), p. ej. ingreso 12/01/2023 → 1201.',
        },
        { status: 400 }
      );
    }

    // ¿Otro colaborador ya usa este username?
    const { data: otherEmp } = await sb
      .from('hr_employees')
      .select('id, full_name')
      .ilike('suite_username', username)
      .neq('id', employeeId)
      .maybeSingle();
    if (otherEmp) {
      return NextResponse.json(
        {
          error: `El usuario «${username}» ya está vinculado a ${formatHrListName(String(otherEmp.full_name || ''))}. Elige otro.`,
        },
        { status: 409 }
      );
    }

    let created = false;
    let suiteUser = await findUserByUsername(username);

    if (!suiteUser) {
      // Si el sugerido está libre como Suite user pero queremos evitar colisión
      // al crear: usar el nombre tal cual.
      suiteUser = await createUser({
        username,
        displayName,
        passwordHash: hashPassword(initial),
        password: initial,
        role: 'viewer',
        modules: ['staff'],
        capabilities: [],
        active: true,
      });
      created = true;
    }
    // Si suiteUser ya existía (roman/roberto): vincular sin regenerar password.

    const { data: linked, error: linkErr } = await sb
      .from('hr_employees')
      .update({
        suite_username: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', employeeId)
      .select('id, full_name, fecha_ingreso, suite_username, status, email')
      .maybeSingle();

    if (linkErr) {
      const dup = /unique|duplicate|hr_employees_suite_username/i.test(
        linkErr.message
      );
      return NextResponse.json(
        {
          error: dup
            ? 'Ese suite_username ya está asignado a otro colaborador'
            : linkErr.message,
        },
        { status: dup ? 409 : 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      linked: true,
      created,
      alreadyHadUser: !created,
      username,
      password: created ? initial : suiteUser.password ?? null,
      displayName: suiteUser.display_name || displayName,
      employee: linked,
      message: created
        ? `Usuario ${username} creado. Contraseña inicial = día+mes de ingreso.`
        : `Usuario ${username} ya existía; se vinculó sin regenerar contraseña.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al crear usuario';
    const status = msg.includes('ya existe') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
