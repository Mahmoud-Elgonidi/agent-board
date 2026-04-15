/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          bg:      '#09090f',
          surface: '#111219',
          card:    '#191c2a',
          cardHov: '#1f2235',
          border:  '#242740',
          borderHov: '#363a5e',
          accent:  '#6366f1',
          accentHov: '#818cf8',
          muted:   '#3d4166',
        },
      },
      boxShadow: {
        'card':      '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        'card-hover':'0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3)',
        'card-drag': '0 20px 40px rgba(0,0,0,0.6), 0 0 0 2px rgba(99,102,241,0.6)',
        'glow-sm':   '0 0 12px rgba(99,102,241,0.3)',
        'glow':      '0 0 24px rgba(99,102,241,0.4)',
        'header':    '0 1px 0 rgba(255,255,255,0.06), 0 4px 24px rgba(0,0,0,0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-fast': 'pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.15s ease-out',
        'slide-up':   'slideUp 0.2s ease-out',
        'shimmer':    'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
