import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette — derived from RFP Pipeline Logo V0.4
        brand: {
          // Coral/red — the "Pipeline" wordmark color
          50: '#fef2f0', 100: '#fde3df', 200: '#fcc8bf', 300: '#f9a393',
          400: '#f47a64', 500: '#e85d4a', 600: '#d44432', 700: '#b23526',
          800: '#932e22', 900: '#7b2a22', 950: '#43120e',
        },
        navy: {
          // Dark ink — "RFP" wordmark + dark backgrounds
          50: '#f5f3f0', 100: '#e8e4de', 200: '#d4cdc3', 300: '#b5aa9b',
          400: '#968775', 500: '#7a6d5e', 600: '#5e5347', 700: '#45403a',
          800: '#2d2a27', 900: '#1a1816', 950: '#0d0c0b',
        },
        award: {
          // Green dot — success/award/verified states
          DEFAULT: '#2d8b4e',
          50: '#edf7f0', 100: '#d5eddc', 200: '#aedbbe', 300: '#7cc497',
          400: '#4faa72', 500: '#2d8b4e', 600: '#237040', 700: '#1c5a34',
          800: '#18482b', 900: '#133b24',
        },
        citrus: {
          // Gold/citrus — dark-mode accent (from logo A3/A4)
          DEFAULT: '#d4a843',
          50: '#fdf8eb', 100: '#f9eece', 200: '#f3db9b', 300: '#ecc463',
          400: '#e5ad3a', 500: '#d4a843', 600: '#b08324', 700: '#8a6520',
          800: '#6f5120', 900: '#5c441f',
        },
        cream: {
          // Warm cream — light backgrounds (from logo bounding boxes)
          DEFAULT: '#f5f0e8',
          50: '#faf8f4', 100: '#f5f0e8', 200: '#ede4d5', 300: '#dfd2bc',
        },
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        prose: ['Georgia', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
