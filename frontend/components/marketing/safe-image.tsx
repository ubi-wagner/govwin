'use client';

/**
 * SafeImage — an <img> that never shows the browser's broken-image glyph.
 * If `src` is missing OR the image fails to load (dead CMS URL, 404, blocked),
 * it renders `fallback` (an initials badge / icon) instead of a broken image.
 * Client component so it can use the onError handler inside server pages.
 */

import { useState, type ReactNode } from 'react';

interface SafeImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
}

export function SafeImage({ src, alt, className, fallback = null }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ''} className={className} onError={() => setFailed(true)} />
  );
}

export default SafeImage;
