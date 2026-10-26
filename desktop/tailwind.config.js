// NexGen palette (facelift 2026-10): teal actions replace the stock blue,
// cool blue-greys replace the stock greys (gray-900 is the navy menu).
const teal = { 50: '#E6F4F5', 100: '#C7E7EA', 200: '#9CD3D8', 300: '#6BBCC4', 400: '#3FA3AD', 500: '#1A8F9A', 600: '#087F8C', 700: '#06636D', 800: '#0A4F57', 900: '#0C3F45' };
const grey = { 50: '#F4F8FA', 100: '#EEF4F7', 200: '#DCE7EC', 300: '#C5D5DE', 400: '#93A9B6', 500: '#5A7080', 600: '#4A6272', 700: '#30495A', 800: '#1F3443', 900: '#142D3C' };

/** @type {import('tailwindcss').Config} */
export default {
  content: ['../shared/ui/**/*.{ts,tsx}', './index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: { primary: teal, blue: teal, gray: grey },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
