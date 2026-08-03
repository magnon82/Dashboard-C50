'use client';

import { useRef, useState } from 'react';
import { prepareDocumentScan } from '@/app/lib/hr-doc-scan';
import { SUITE } from '@/app/lib/themes';

type Props = {
  title: string;
  required?: boolean;
  file: File | null;
  disabled?: boolean;
  onChange: (file: File | null) => void;
};

/**
 * Captura de documentación: Escanear (cámara trasera) vs Archivo/galería.
 * En móvil PWA, `capture="environment"` abre la cámara como escáner.
 */
export function HrDocScanPicker({
  title,
  required,
  file,
  disabled,
  onChange,
}: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handlePick(raw: File | null) {
    if (!raw) return;
    setBusy(true);
    try {
      onChange(await prepareDocumentScan(raw));
    } finally {
      setBusy(false);
      if (scanRef.current) scanRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700">
            {title}
            {required ? <span className="text-rose-600"> *</span> : null}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {file
              ? file.name
              : busy
                ? 'Preparando escaneo…'
                : 'Sin documento'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => void handlePick(e.target.files?.[0] || null)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => void handlePick(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            disabled={disabled || busy}
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: SUITE.navy }}
            onClick={() => scanRef.current?.click()}
          >
            Escanear
          </button>
          <button
            type="button"
            disabled={disabled || busy}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
          >
            Archivo
          </button>
          {file ? (
            <button
              type="button"
              disabled={disabled || busy}
              className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 disabled:opacity-50"
              onClick={() => onChange(null)}
            >
              Quitar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
