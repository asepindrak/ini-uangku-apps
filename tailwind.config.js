/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        'brand-sky': {
          DEFAULT: '#C1ECFD',
          light: '#EBF8FE',
          dark: '#8ED7FA',
        },
        'brand-peach': {
          DEFAULT: '#FFC1B6',
          light: '#FFF0ED',
          dark: '#FA9E90',
        },
        'brand-butter': {
          DEFAULT: '#FDEEAD',
          light: '#FFFDF0',
          dark: '#F5DC76',
        },
        'brand-indigo': {
          DEFAULT: '#443D66',
          light: '#655C8F',
          dark: '#29243C',
        },
        'brand-mint': {
          DEFAULT: '#C3F0DE',
          light: '#EAFBF4',
          dark: '#8DE2BE',
        },
        'glass-bg': 'rgba(255, 255, 255, 0.72)',
        'glass-card': 'rgba(255, 255, 255, 0.65)',
        'glass-border': 'rgba(255, 255, 255, 0.60)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(68, 61, 102, 0.08)',
        'glass-sm': '0 4px 16px 0 rgba(68, 61, 102, 0.05)',
        'glass-lg': '0 12px 40px 0 rgba(68, 61, 102, 0.12)',
        'glow-sky': '0 0 25px rgba(193, 236, 253, 0.6)',
        'glow-peach': '0 0 25px rgba(255, 193, 182, 0.6)',
      },
      backdropBlur: {
        'xs': '2px',
      }
    },
  },
  plugins: [],
};
