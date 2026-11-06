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
        // Brand: navy and emerald. Navy carries the frame (sidebar, hero,
        // footer); emerald is the one action colour. Values mirror the custom
        // properties in globals.css.
        navy: {
          50: '#F3F6FA',
          100: '#E7EDF4',
          200: '#C9D6E3',
          300: '#9FB3C8',
          600: '#3A5A7C',
          700: '#264563', // active sidebar item
          800: '#1D3A5F',
          900: '#142D4E', // primary navy
          950: '#0B1F36', // dark navy
        },
        // Emerald: primary buttons and accents. 600 is the button, 700 its
        // hover and the shade used for green text (4.7:1 on white; 600 is
        // 3.2:1, too light for body-size text).
        brand: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          400: '#34B37E',
          500: '#1BAA70',
          600: '#16A36A',
          700: '#128456',
          800: '#0E6A45',
          900: '#0B5236',
        },
        // Amber: pending, waiting on a person, AI-proposed. Never an error.
        marigold: {
          300: '#FCD34D',
          400: '#F59E0B',
        },
        // Pale fills: 50 a neutral hover, 100 the amber wash behind pending things.
        honey: {
          50: '#F4F7FA',
          100: '#FFFBEB',
        },
        // Neutrals: slate, cool to sit with navy.
        ink: {
          300: '#CBD5E1',
          400: '#8492A6',
          500: '#64748B', // secondary text
          600: '#475569',
          700: '#334155',
          900: '#1E293B', // primary text
        },
        line: {
          100: '#EEF2F6', // row dividers
          200: '#E2E8F0', // borders
        },
        surface: {
          card: '#FFFFFF',
          page: '#F5F7FA',
          sink: '#F1F5F9',
        },
        roast: {
          900: '#0B1F36',
        },
        // Semantic states.
        // Kept as literal hex rather than var(--token) so Tailwind's opacity
        // modifiers (border-error-fg/20) resolve; the values mirror the
        // custom properties of the same name in globals.css.
        pending: {
          fg: '#B45309',
          bg: '#FFFBEB',
        },
        success: {
          fg: '#15803D',
          bg: '#F0FDF4',
        },
        error: {
          fg: '#DC2626',
          bg: '#FEF2F2',
        },
        info: {
          fg: '#2563EB',
          bg: '#EFF6FF',
        },
        // Dashboard figures: expenses are orange.
        expense: {
          fg: '#C2410C',
          DEFAULT: '#EA580C',
          bg: '#FFF7ED',
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
        // Manrope for headings, Inter for everything else. `heading` and
        // `display` are the same face under the two names the pages use.
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        // Amounts and IDs: Inter with tabular figures (globals.css), so
        // columns of money line up. The class keeps its old name.
        mono: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Two sizes above the old ceiling, for the landing page and empty
        // states. Line-height tightens as size grows, which is what stops a
        // large headline reading as a scaled-up paragraph.
        'display-xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '1.05', fontWeight: '800' }],
        'display-lg': ['clamp(2.25rem, 4.5vw, 3.25rem)', { lineHeight: '1.1', fontWeight: '800' }],
        display: ['2.75rem', { lineHeight: '1.1', fontWeight: '700' }],
        h1: ['2rem', { lineHeight: '1.2', fontWeight: '700' }],
        h2: ['1.5rem', { lineHeight: '1.25', fontWeight: '700' }],
        h3: ['1.25rem', { lineHeight: '1.35', fontWeight: '700' }],
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
        // Cards: 12px (rounded-xl) and 16px (rounded-lg, rounded-2xl).
        xl: '12px',
        lg: '16px',
        '2xl': '16px',
        full: '9999px',
      },
      boxShadow: {
        e1: '0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)',
        e2: '0 8px 24px rgba(15,23,42,.08)',
        e3: '0 20px 48px rgba(15,23,42,.16)',
      },
      keyframes: {
        'amber-to-green': {
          '0%': { borderLeftColor: '#F59E0B' },
          '100%': { borderLeftColor: '#15803D' },
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
