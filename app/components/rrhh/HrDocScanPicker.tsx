'use client';

import { useRef, useState } from 'react';
import {
  prepareHrCapture,
  type HrCaptureMode,
} from '@/app/lib/hr-doc-scan';
import { SUITE } from '@/app/lib/themes';

export type { HrCaptureMode };

type Props = {
  title: string;
  required?: boolean;
  file: File | null;
  disabled?: boolean;
  /** Muestra botón Foto (cámara sin pipeline de documento). */
  allowPhoto?: boolean;
  /** Modo de la captura actual (opcional, solo display). */
  captureMode?: HrCaptureMode | null;
  onChange: (file: File | null, mode?: HrCaptureMode | null) => void;
};

/**
 * Captura: Escanear (doc) · Foto · Archivo/galería.
 * En móvil PWA, `capture="environment"` abre la cámara.
 */
export function HrDocScanPicker({
  title,
  required,
  file,
  disabled,
  allowPhoto = false,
  captureMode = null,
  onChange,
}: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState<HrCaptureMode | null>(
    captureMode
  );

  async function handlePick(raw: File | null, mode: HrCaptureMode) {
    if (!raw) return;
    setBusy(true);
    try {
      // Sin allowPhoto (alta/docs): Archivo también pasa por pipeline de documento.
      const prepMode: HrCaptureMode =
        mode === 'file' && !allowPhoto ? 'scan' : mode;
      const prepared = await prepareHrCapture(raw, prepMode);
      setActiveMode(mode);
      onChange(prepared, mode);
    } finally {
      setBusy(false);
      if (scanRef.current) scanRef.current.value = '';
      if (photoRef.current) photoRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const statusLabel = (() => {
    if (busy) {
      if (activeMode === 'photo') return 'Preparando foto…';
      if (activeMode === 'scan') return 'Preparando escaneo…';
      return 'Preparando…';
    }
    if (!file) return 'Sin documento';
    const mode = captureMode ?? activeMode;
    if (mode === 'photo') return `${file.name} · foto`;
    if (mode === 'scan') return `${file.name} · escaneo`;
    return file.name;
  })();

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700">
            {title}
            {required ? <span className="text-rose-600"> *</span> : null}
          </p>
          <p className="truncate text-[11px] text-slate-500">{statusLabel}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) =>
              void handlePick(e.target.files?.[0] || null, 'scan')
            }
          />
          {allowPhoto ? (
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={disabled || busy}
              onChange={(e) =>
                void handlePick(e.target.files?.[0] || null, 'photo')
              }
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) =>
              void handlePick(e.target.files?.[0] || null, 'file')
            }
          />
          <button
            type="button"
            disabled={disabled || busy}
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: SUITE.navy }}
            onClick={() => {
              setActiveMode('scan');
              scanRef.current?.click();
            }}
          >
            Escanear
          </button>
          {allowPhoto ? (
            <button
              type="button"
              disabled={disabled || busy}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
              onClick={() => {
                setActiveMode('photo');
                photoRef.current?.click();
              }}
            >
              Foto
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled || busy}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
            onClick={() => {
              setActiveMode('file');
              fileRef.current?.click();
            }}
          >
            Archivo
          </button>
          {file ? (
            <button
              type="button"
              disabled={disabled || busy}
              className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 disabled:opacity-50"
              onClick={() => {
                setActiveMode(null);
                onChange(null, null);
              }}
            >
              Quitar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
