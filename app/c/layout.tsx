import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Cotización · Carranza 50',
};

/** Vista pública sin chrome de Suite; no indexar. */
export default function PublicCotizacionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
