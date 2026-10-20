import type { Glyph } from './icons';

const SIZES = { sm: 14, md: 18, lg: 22 } as const;

export interface IconProps {
  glyph: Glyph;
  size?: keyof typeof SIZES;
  /** Words for a screen reader. An icon that sits next to its own text has none and is hidden from them. */
  label?: string;
  className?: string;
}

export function Icon({ glyph: GlyphIcon, size = 'md', label, className }: IconProps) {
  return (
    <GlyphIcon
      size={SIZES[size]}
      strokeWidth={2}
      className={className}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
