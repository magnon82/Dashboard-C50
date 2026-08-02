import { PRODUCT_ORG } from '@/app/lib/product';

type BrandLogoVariant = 'navy' | 'onDark';

const SRC: Record<BrandLogoVariant, string> = {
  navy: '/brand/logo-c50.svg',
  onDark: '/brand/logo-c50-on-dark.svg',
};

/**
 * Wordmark Carranza 50 (transparent SVG).
 * `navy` → fondos claros (encabezados) · `onDark` → fondos navy (login).
 */
export function BrandLogo({
  variant = 'navy',
  className = '',
  priority = false,
}: {
  variant?: BrandLogoVariant;
  className?: string;
  /** hint for LCP on login */
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG brand mark; avoid Image optimizer on vector
    <img
      src={SRC[variant]}
      alt={PRODUCT_ORG}
      width={595}
      height={212}
      className={className}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : {})}
    />
  );
}
