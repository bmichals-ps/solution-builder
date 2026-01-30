import { ReactNode, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  ...props
}, ref) => {
  const baseStyles = `
    relative inline-flex items-center justify-center font-medium
    transition-all duration-200 ease-out
    focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]
    disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
    select-none
  `;
  
  const variants = {
    primary: `
      bg-gradient-to-b from-[#6366f1] to-[#4f46e5]
      text-white font-medium
      shadow-[0_1px_2px_rgba(0,0,0,0.3),0_2px_8px_rgba(79,70,229,0.25),inset_0_1px_0_rgba(255,255,255,0.1)]
      hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(79,70,229,0.35),inset_0_1px_0_rgba(255,255,255,0.15)]
      hover:from-[#6d70f3] hover:to-[#5549e8]
      active:from-[#5558e8] active:to-[#4338ca]
      focus-visible:ring-indigo-500
    `,
    secondary: `
      bg-[#1a1a28] 
      text-[#e8e8f0]
      border border-[rgba(255,255,255,0.08)]
      shadow-[0_1px_2px_rgba(0,0,0,0.25)]
      hover:bg-[#252535] hover:border-[rgba(255,255,255,0.12)]
      active:bg-[#1a1a28]
      focus-visible:ring-slate-500
    `,
    outline: `
      bg-transparent
      text-[#a3a3bd]
      border border-[rgba(255,255,255,0.1)]
      hover:text-[#e8e8f0] hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]
      active:bg-[rgba(255,255,255,0.02)]
      focus-visible:ring-slate-500
    `,
    ghost: `
      bg-transparent
      text-[#8585a3]
      hover:text-[#c4c4d6] hover:bg-[rgba(255,255,255,0.04)]
      active:bg-[rgba(255,255,255,0.02)]
      focus-visible:ring-slate-500
    `,
    danger: `
      bg-gradient-to-b from-[#ef4444] to-[#dc2626]
      text-white font-medium
      shadow-[0_1px_2px_rgba(0,0,0,0.3),0_2px_8px_rgba(220,38,38,0.2)]
      hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(220,38,38,0.3)]
      hover:from-[#f35555] hover:to-[#e02929]
      focus-visible:ring-red-500
    `,
  };
  
  const sizes = {
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-[14px] gap-2 rounded-[10px]',
    lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  };
  
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`
        ${baseStyles}
        ${variants[variant]}
        ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : iconPosition === 'left' && icon ? (
        <span className="opacity-80">{icon}</span>
      ) : null}
      <span>{children}</span>
      {!loading && iconPosition === 'right' && icon && (
        <span className="opacity-80">{icon}</span>
      )}
    </button>
  );
});

Button.displayName = 'Button';
