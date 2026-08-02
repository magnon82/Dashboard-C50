'use client';

import { useCallback, useEffect, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import {
  RrhhSectionNav,
  type RrhhSection,
} from '@/app/components/rrhh/RrhhSectionNav';
import { RrhhPlantilla } from '@/app/components/rrhh/RrhhPlantilla';
import { RrhhBiblioteca } from '@/app/components/rrhh/RrhhBiblioteca';
import { RrhhVacaciones } from '@/app/components/rrhh/RrhhVacaciones';
import { RrhhHorarios } from '@/app/components/rrhh/RrhhHorarios';
import { RrhhNomina } from '@/app/components/rrhh/RrhhNomina';
import type { HrEmployee, HrDocLink } from '@/app/lib/hr';

type EmployeesPayload = {
  ready: boolean;
  source?: string;
  employees: HrEmployee[];
  count: number;
  periodLabel: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  periodStatus?: string | null;
  seeded?: boolean;
  message?: string | null;
  error?: string;
  code?: string | null;
};

type DocsPayload = {
  ready: boolean;
  source?: string;
  docs: HrDocLink[];
  message?: string;
  error?: string;
};

export default function RrhhPage() {
  const [section, setSection] = useState<RrhhSection>('plantilla');
  const [employees, setEmployees] = useState<EmployeesPayload | null>(null);
  const [docs, setDocs] = useState<DocsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, docsRes] = await Promise.all([
        fetch('/api/hr/employees', { cache: 'no-store' }),
        fetch('/api/hr/docs', { cache: 'no-store' }),
      ]);
      const [empJson, docsJson] = await Promise.all([
        empRes.json(),
        docsRes.json(),
      ]);
      setEmployees(empJson);
      setDocs(docsJson);
    } catch {
      setEmployees({
        ready: false,
        employees: [],
        count: 0,
        periodLabel: null,
        periodEnd: null,
        paidAt: null,
        message: 'Error de red al cargar plantilla',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SuiteShell title="Recursos Humanos" subtitle={`Gestión de equipo · ${hoy}`}>
      <RrhhSectionNav active={section} onChange={setSection} />

      {section === 'plantilla' && (
        <RrhhPlantilla
          data={employees}
          loading={loading}
          onChanged={refresh}
          onGoBiblioteca={() => setSection('biblioteca')}
        />
      )}

      {section === 'horarios' && <RrhhHorarios />}

      {section === 'nomina' && <RrhhNomina onChanged={refresh} />}

      {section === 'vacaciones' && <RrhhVacaciones />}

      {section === 'biblioteca' && (
        <RrhhBiblioteca data={docs} loading={loading} />
      )}
    </SuiteShell>
  );
}
