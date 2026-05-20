/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#4F46E5',
          mid:     '#6366F1',
          dim:     '#EEF2FF',
          dark:    '#3730A3',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          2:       '#F8FAFC',
        },
        text: {
          1: '#0F172A',
          2: '#334155',
          3: '#94A3B8',
        },
        border: '#E2E8F0',
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
      },
      boxShadow: {
        card:  '0 2px 12px rgba(0,0,0,0.08)',
        modal: '0 8px 40px rgba(0,0,0,0.16)',
      },
    },
  },
  plugins: [],
}
