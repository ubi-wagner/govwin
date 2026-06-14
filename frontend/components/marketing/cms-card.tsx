import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarketingIcon } from '@/components/marketing/icons';

export interface CmsCardProps {
  image?: string | null;
  icon?: string;
  href?: string;
  label?: string;
  title: string | ReactNode;
  body: string | ReactNode;
  className?: string;
}

export function CmsCard({ image, icon, href, label, title, body, className = '' }: CmsCardProps) {
  const cardClass = `overflow-hidden ${href ? 'group cursor-pointer' : ''} ${className}`;

  const inner = (
    <>
      {image && (
        <img src={image} alt={typeof title === 'string' ? title : ''} className="w-full h-44 object-cover" />
      )}
      <div className="p-8">
        {icon && !image && <MarketingIcon name={icon} className="h-9 w-9 text-brand-600 mb-4" />}
        {label && (
          <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">{label}</p>
        )}
        <h3 className="font-display text-xl font-bold text-navy-900 group-hover:text-brand-600 transition-colors">
          {title}
        </h3>
        <div className="mt-3 text-navy-600 leading-relaxed">{body}</div>
        {href && (
          <span className="mt-4 inline-block text-sm font-semibold text-brand-500 group-hover:text-brand-700 transition-colors">
            Learn more &rarr;
          </span>
        )}
      </div>
    </>
  );

  if (href) {
    const isExternal = href.startsWith('http');
    return isExternal ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cardClass}>{inner}</a>
    ) : (
      <Link href={href} className={cardClass}>{inner}</Link>
    );
  }

  return <div className={cardClass}>{inner}</div>;
}
