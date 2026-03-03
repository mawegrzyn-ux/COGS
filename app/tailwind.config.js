/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#146A34',
          mid:     '#1E8A44',
          dim:     '#E8F5ED',
          dark:    '#0D4D26',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          2:       '#F7F9F8',
        },
        text: {
          1: '#0F1F17',
          2: '#2D4A38',
          3: '#6B7F74',
        },
        border: '#D8E6DD',
      },
      fontFamily: {
        sans:  ['Nunito', 'sans-serif'],
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
