const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: c('bg'), panel: c('panel'), panel2: c('panel2'), line: c('line'),
        ink: c('ink'), mute: c('mute'), brand: c('brand'),
        ok: c('ok'), info: c('info'), warn: c('warn'), danger: c('danger'), crit: c('crit'),
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseRing: { '0%': { transform: 'scale(1)', opacity: '.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        shake: { '0%,100%': { transform: 'translateX(0)' }, '20%,60%': { transform: 'translateX(-3px)' }, '40%,80%': { transform: 'translateX(3px)' } },
      },
      animation: { shimmer: 'shimmer 1.6s infinite', pulseRing: 'pulseRing 1.8s ease-out infinite', shake: 'shake .5s ease-in-out' },
    },
  },
  plugins: [],
};
