/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#ffffff',
          text: '#0f172a',
          muted: '#64748b',
          ring: '#e2e8f0',
          focus: '#2563eb',
          // brighter day variant
          bgBright: '#ffffff',
          textBright: '#0b1220',
          mutedBright: '#475569',
          ringBright: '#f1f5f9',
          focusBright: '#4f46e5',
        },
      },
    },
  },
  plugins: [],
};
