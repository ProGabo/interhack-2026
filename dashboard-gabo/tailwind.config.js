/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brandGold: "#F5B100",
        brandRed: "#BE123C",
      },
      fontFamily: {
        technical: ["Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
}
