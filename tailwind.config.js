/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cosmic/Growth Theme Colors - Enhanced Professional Palette
        cosmic: {
          dark: "#0a0e1a",           // Deepest space
          "dark-soft": "#151b2e",    // Softer dark with subtle blue
          "dark-card": "rgba(21, 27, 46, 0.6)", // Glassmorphism cards
          cyan: "#00d9ff",           // Bright cyan
          "cyan-light": "#33e0ff",   // Lighter cyan
          "cyan-dark": "#00b8d4",    // Darker cyan
          green: "#00ff88",          // Lime green
          "green-light": "#33ffa8",  // Lighter green
          purple: "#a855f7",         // Purple accent
          "purple-light": "#c084fc", // Lighter purple
          neutral: "#f0f4f8",        // Light gray
        },
        status: {
          success: "#00ff88",
          error: "#ff5459",
          warning: "#fbbf24",
          info: "#00d9ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["Fira Code", "monospace"],
      },
      backgroundImage: {
        'cosmic-gradient': 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 50%, #1a1f3a 100%)',
        'cosmic-gradient-radial': 'radial-gradient(ellipse at top, #1a1f3a 0%, #0a0e1a 100%)',
        'cosmic-shimmer': 'linear-gradient(90deg, transparent, rgba(0, 217, 255, 0.1), transparent)',
      },
      boxShadow: {
        'cosmic': '0 0 20px rgba(0, 217, 255, 0.3)',
        'cosmic-lg': '0 0 40px rgba(0, 217, 255, 0.4)',
        'cosmic-green': '0 0 20px rgba(0, 255, 136, 0.3)',
        'cosmic-purple': '0 0 20px rgba(168, 85, 247, 0.3)',
      },
      animation: {
        'shimmer': 'shimmer 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-cosmic': 'pulse-cosmic 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        'pulse-cosmic': {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 20px rgba(0, 217, 255, 0.3)' },
          '50%': { opacity: 0.8, boxShadow: '0 0 40px rgba(0, 217, 255, 0.6)' },
        },
      },
    },
  },
  plugins: [],
};
