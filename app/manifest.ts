import type { MetadataRoute } from 'next';
import { PRODUCT_NAME, PRODUCT_ORG, PRODUCT_TAGLINE } from '@/app/lib/product';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${PRODUCT_NAME} · Carranza 50`,
    short_name: 'C50 Suite',
    description: `${PRODUCT_TAGLINE} · ${PRODUCT_ORG}`,
    start_url: '/',
    display: 'standalone',
    background_color: '#0B1F3A',
    theme_color: '#0B1F3A',
    lang: 'es-MX',
    orientation: 'any',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
