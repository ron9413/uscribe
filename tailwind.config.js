/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
        colors: {
            'notes-bg': '#f5f5f7',
            'notes-sidebar': '#e8e8ed',
            'notes-selected': '#ffd60a',
            'notes-text': '#1d1d1f',
            'notes-border': '#d2d2d7',
        }
    },
  },
  plugins: [],
}
