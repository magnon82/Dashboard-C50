import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: 'Reservar mesa · Carranza 50',
  description:
    'Solicita tu mesa en Carranza 50. Te llega por WhatsApp y te confirmamos en breve.',
};

/** Vista pública sin chrome de Suite. */
export default function ReservarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
