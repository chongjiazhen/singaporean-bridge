import type { Card as CardType } from '../engine/types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../engine/types';

interface CardProps {
  card?: CardType;
  faceUp?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  size?: 'small' | 'medium' | 'large';
}

const sizeClasses = {
  small: 'w-10 h-14 text-xs',
  medium: 'w-16 h-22 text-sm',
  large: 'w-20 h-28 text-base',
};

export function CardComponent({ card, faceUp = true, selected = false, onClick, className = '', size = 'medium' }: CardProps) {
  const baseClasses = `
    relative rounded-lg border-2 shadow-lg transition-all duration-200
    ${sizeClasses[size]}
    ${selected ? 'ring-2 ring-yellow-400 -translate-y-2 shadow-xl' : ''}
    ${onClick ? 'cursor-pointer hover:scale-105' : ''}
    ${className}
  `;

  if (!faceUp || !card) {
    return (
      <div className={baseClasses} onClick={onClick}>
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg border border-blue-400 flex items-center justify-center">
          <svg className="w-3/4 h-3/4 text-blue-200" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
            <path d="M12 6c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
          </svg>
        </div>
      </div>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitColor = SUIT_COLORS[card.suit];
  const colorClass = suitColor === 'red' ? 'text-red-600' : 'text-gray-900';

  return (
    <div className={baseClasses} onClick={onClick}>
      <div className="absolute inset-0 bg-white rounded-lg flex flex-col p-1.5">
        {/* Top left rank and suit */}
        <div className="flex flex-col items-start">
          <span className={`${colorClass} font-bold leading-none`}>{card.rank}</span>
          <span className={`${colorClass} leading-none`}>{suitSymbol}</span>
        </div>

        {/* Center suit symbol */}
        <div className="flex-1 flex items-center justify-center">
          <span className={`${colorClass} text-2xl ${size === 'small' ? 'text-lg' : size === 'large' ? 'text-4xl' : ''}`}>{suitSymbol}</span>
        </div>
      </div>
    </div>
  );
}