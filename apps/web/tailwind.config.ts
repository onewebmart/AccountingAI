import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand — warm
        saffron: {
          500: '#F76707',
          600: '#E8590C',
          700: '#C84A06',
        },
        marigold: {
          300: '#FFD43B',
          400: '#FAB005',
        },
        honey: {
          50: '#FFFBF2',
          100: '#FFF4DC',
        },
        // Neutrals
        ink: {
          400: '#A8998A',
          500: '#7A6E60',
          700: '#3A322A',
          900: '#1F1A15',
        },
        line: {
          200: '#EBE3D7',
        },
        surface: {
          card: '#FFFFFF',
          page: '#FFFCF6',
          sink: '#F6EFE3',
        },
        roast: {
          900: '#241A11',
        },
        // Semantic states.
        // Kept as literal hex rather than var(--token) so Tailwind's opacity
        // modifiers (border-error-fg/20) resolve; the values mirror the
        // custom properties of the same name in globals.css.
        pending: {
          fg: '#945800',
          bg: '#FFF4DC',
        },
        success: {
          fg: '#1E7A47',
          bg: '#E6F6EE',
        },
        error: {
          fg: '#C92A2A',
          bg: '#FBE9E9',
        },
        info: {
          fg: '#3B5BC0',
          bg: '#E9EDFB',
        },
        // shadcn compatibility mappings
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        // `font-heading` is used in 54 places and was defined nowhere, so every
        // one of those headings silently fell back to the browser's default
        // sans — Bricolage never rendered on them. Aliased rather than renamed
        // across 14 files: both names now resolve to the display face.
        heading: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      fontSize: {
        // Two sizes above the old ceiling, for the landing page and empty
        // states. Line-height tightens as size grows, which is what stops a
        // large headline reading as a scaled-up paragraph.
        'display-xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '0.98', fontWeight: '700' }],
        'display-lg': ['clamp(2.25rem, 4.5vw, 3.25rem)', { lineHeight: '1.02', fontWeight: '700' }],
        display: ['2.75rem', { lineHeight: '1.05', fontWeight: '700' }],
        h1: ['2rem', { lineHeight: '1.15', fontWeight: '600' }],
        h2: ['1.5rem', { lineHeight: '1.2', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg': ['1.0625rem', { lineHeight: '1.55' }],
        body: ['0.9375rem', { lineHeight: '1.55' }],
        label: ['0.8125rem', { lineHeight: '1.4', fontWeight: '500' }],
        caption: ['0.75rem', { lineHeight: '1.4' }],
        'mono-data': ['0.9375rem', { lineHeight: '1.4' }],
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
        full: '9999px',
      },
      boxShadow: {
        e1: '0 1px 2px rgba(36,26,17,.06), 0 1px 1px rgba(36,26,17,.04)',
        e2: '0 6px 20px rgba(36,26,17,.10)',
        e3: '0 16px 48px rgba(36,26,17,.18)',
      },
      keyframes: {
        'amber-to-green': {
          '0%': { borderLeftColor: '#FAB005' },
          '100%': { borderLeftColor: '#1E7A47' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'amber-to-green': 'amber-to-green 200ms ease-out forwards',
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      maxWidth: {
        content: '1200px',
      },
      width: {
        sidebar: '260px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
