import { EventosManualSeguimiento } from '@/app/components/eventos/EventosManualSeguimiento';
import { SUITE } from '@/app/lib/themes';

export default function ManualSeguimientoPage() {
  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      <div
        className="border-b"
        style={{
          backgroundColor: SUITE.navy,
          borderColor: SUITE.navyDeep,
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-sm font-bold text-white">Carranza 50 · Eventos</p>
          <a
            href="/eventos"
            className="text-xs font-semibold text-white/80 hover:text-white"
          >
            Ir al módulo
          </a>
        </div>
      </div>
      <EventosManualSeguimiento />
    </div>
  );
}
