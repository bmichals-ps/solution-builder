import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'elevated' | 'outlined' | 'ghost';
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ 
  children, 
  className = '', 
  padding = 'md',
  variant = 'default',
  hover = false,
  onClick,
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };

  const variants = {
    default: `
      bg-[rgba(20,20,31,0.6)]
      border border-[rgba(255,255,255,0.05)]
      shadow-[0_2px_8px_rgba(0,0,0,0.15)]
    `,
    elevated: `
      bg-gradient-to-b from-[rgba(26,26,40,0.9)] to-[rgba(20,20,31,0.95)]
      border border-[rgba(255,255,255,0.06)]
      shadow-[0_4px_24px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.2)]
    `,
    outlined: `
      bg-transparent
      border border-[rgba(255,255,255,0.08)]
    `,
    ghost: `
      bg-[rgba(255,255,255,0.02)]
      border border-transparent
    `,
  };

  const hoverStyles = hover ? `
    cursor-pointer
    transition-all duration-200 ease-out
    hover:border-[rgba(99,102,241,0.25)]
    hover:bg-[rgba(99,102,241,0.04)]
    hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),0_0_0_1px_rgba(99,102,241,0.1)]
  ` : '';
  
  return (
    <div
      onClick={onClick}
      className={`
        rounded-xl backdrop-blur-sm
        ${variants[variant]}
        ${paddings[padding]}
        ${hoverStyles}
        ${onClick && !hover ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
}

export function CardHeader({ title, description, icon, action, size = 'md' }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between ${size === 'md' ? 'mb-5' : 'mb-4'}`}>
      <div className="flex items-start gap-3.5">
        {icon && (
          <div className={`
            ${size === 'md' ? 'w-10 h-10' : 'w-9 h-9'}
            rounded-[10px] 
            bg-gradient-to-b from-[rgba(99,102,241,0.15)] to-[rgba(99,102,241,0.08)]
            border border-[rgba(99,102,241,0.15)]
            flex items-center justify-center 
            text-[#818cf8]
          `}>
            {icon}
          </div>
        )}
        <div>
          <h3 className={`
            ${size === 'md' ? 'text-[17px]' : 'text-[15px]'} 
            font-semibold text-[#e8e8f0] tracking-[-0.01em]
          `}>
            {title}
          </h3>
          {description && (
            <p className={`
              ${size === 'md' ? 'text-[14px] mt-1' : 'text-[13px] mt-0.5'} 
              text-[#8585a3] leading-relaxed
            `}>
              {description}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}
