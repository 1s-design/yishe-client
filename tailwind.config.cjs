/** @type {import('tailwindcss').Config} */
console.log("tailwind config loaded with", process.cwd());
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          primary: "#7d8d79",
          surface: "#f6f1e8",
        },
      },
    },
  },
  plugins: [],
};
