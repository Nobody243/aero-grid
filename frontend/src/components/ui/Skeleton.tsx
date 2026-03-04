import React from 'react';

// Tiny shimmer block. Sizing comes entirely from className; the shimmer
// animation is defined as the `shimmer` keyframe in globals.css. No library.
export const Skeleton: React.FC<{ className?: string; rounded?: string }> = ({
  className = '',
  rounded = 'rounded-[3px]',
}) => (
  <div
    aria-hidden
    className={`relative overflow-hidden bg-[#0e1421] border border-[#1c2d4a] ${rounded} ${className}`}
  >
    <div
      className="absolute inset-0 -translate-x-full animate-skeleton-shimmer"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, rgba(58, 79, 107, 0.18) 50%, transparent 100%)',
      }}
    />
  </div>
);
