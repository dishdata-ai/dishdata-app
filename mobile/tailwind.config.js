/** @type {import('tailwindcss').Config} */
module.exports = {
  // Mirrors the web app's @theme tokens in src/app/globals.css so the two
  // surfaces share one visual language.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        base: "#08080d",
        surface: "#11131a",
        raised: "#181b25",
        line: "#262a38",
        brand: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
        },
        accent: {
          400: "#22d3ee",
        },
        "violet-soft": "#a78bfa",
        "amber-soft": "#fbbf24",
        "rose-soft": "#fb7185",
      },
    },
  },
  plugins: [],
};
