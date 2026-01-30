import { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ 
  label, 
  error, 
  helperText, 
  icon,
  className = '',
  ...props 
}, ref) => {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-[13px] font-medium text-[#c4c4d6] tracking-[-0.01em]">
          {label}
          {props.required && <span className="text-[#f87171] ml-1">*</span>}
        </label>
      )}
      <div className="relative group">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5c5c78] transition-colors group-focus-within:text-[#818cf8]">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={`
            w-full h-11 px-4 
            bg-[rgba(10,10,15,0.6)]
            border rounded-[10px]
            text-[15px] text-[#e8e8f0] placeholder-[#5c5c78]
            transition-all duration-200 ease-out
            focus:outline-none
            ${icon ? 'pl-11' : ''}
            ${error 
              ? 'border-[rgba(239,68,68,0.5)] focus:border-[#ef4444] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]' 
              : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.12)] focus:border-[rgba(99,102,241,0.5)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]'
            }
            ${className}
          `}
          {...props}
        />
      </div>
      {error && (
        <p className="text-[13px] text-[#f87171] flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="text-[13px] text-[#5c5c78]">{helperText}</p>
      )}
    </div>
  );
});

Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ 
  label, 
  error, 
  helperText,
  className = '',
  ...props 
}, ref) => {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-[13px] font-medium text-[#c4c4d6] tracking-[-0.01em]">
          {label}
          {props.required && <span className="text-[#f87171] ml-1">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        className={`
          w-full px-4 py-3
          bg-[rgba(10,10,15,0.6)]
          border rounded-xl
          text-[15px] text-[#e8e8f0] placeholder-[#5c5c78]
          leading-relaxed resize-none
          transition-all duration-200 ease-out
          focus:outline-none
          ${error 
            ? 'border-[rgba(239,68,68,0.5)] focus:border-[#ef4444] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]' 
            : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.12)] focus:border-[rgba(99,102,241,0.5)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]'
          }
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="text-[13px] text-[#f87171] flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="text-[13px] text-[#5c5c78]">{helperText}</p>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';
