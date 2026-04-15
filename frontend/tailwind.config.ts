import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b1120',
          elev: '#0f172a',
          card: '#111c32',
          hover: '#172346',
        },
        line: '#1e293b',
        ink: {
          DEFAULT: '#e2e8f0',
          muted: '#94a3b8',
          dim: '#64748b',
        },
        brand: {
          DEFAULT: '#34d399',
          dim: '#10b981',
        },
        up: '#34d399',
        down: '#f87171',
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;