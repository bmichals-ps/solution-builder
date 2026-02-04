/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        'display': ['2.75rem', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.035em' }],
        'headline': ['1.875rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.025em' }],
        'title': ['1.25rem', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '-0.02em' }],
      },
      colors: {
        slate: {
          950: '#0a0a0f',
          900: '#0f0f18',
          850: '#14141f',
          800: '#1a1a28',
          700: '#252535',
          600: '#3d3d52',
          500: '#5c5c78',
          400: '#8585a3',
          300: '#a3a3bd',
          200: '#c4c4d6',
          100: '#e8e8f0',
        },
        accent: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      borderRadius: {
        'sm': '6px',
        'md': '10px',
        'lg': '14px',
        'xl': '18px',
        '2xl': '24px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.15)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.35), 0 4px 6px -4px rgba(0, 0, 0, 0.2)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.25)',
        'glow': '0 0 40px -12px rgba(99, 102, 241, 0.35)',
        'glow-sm': '0 0 20px -8px rgba(99, 102, 241, 0.25)',
      },
      animation: {
        'fade-up': 'fadeUp 0.5s cubic-bezier(0.19, 1, 0.22, 1) forwards',
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.19, 1, 0.22, 1) forwards',
        'pulse-subtle': 'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 20px -8px rgba(99, 102, 241, 0.4)' },
          '50%': { opacity: '0.85', boxShadow: '0 0 30px -5px rgba(99, 102, 241, 0.6)' },
        },
      },
    },
  },
  plugins: [],
}
