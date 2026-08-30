/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * These tokens are the SAME palette the CSS variables in index.css
       * define — not a second copy of it.
       *
       * They used to be literal hex values from the old dark-forest theme.
       * When the app was restyled light, index.css changed and this file did
       * not, so every `bg-card2` / `text-dim` / `border-line` in the codebase
       * kept painting dark-theme colours onto a light screen — the Settings,
       * Add Animal and Device Details screens rendered on a near-black
       * background, and `bg-danger` did not exist at all, which left the
       * full-screen danger takeover completely transparent and unreadable.
       *
       * The channels live in index.css as `--x-rgb: 245 247 243`, and
       * <alpha-value> keeps opacity modifiers (bg-red/10) working, which a
       * bare var() reference would silently break.
       */
      colors: {
        bg:        'rgb(var(--bg-rgb) / <alpha-value>)',
        bg2:       'rgb(var(--bg-2-rgb) / <alpha-value>)',
        card:      'rgb(var(--card-rgb) / <alpha-value>)',
        card2:     'rgb(var(--card-2-rgb) / <alpha-value>)',
        line:      'rgb(var(--line-rgb) / <alpha-value>)',
        text:      'rgb(var(--text-rgb) / <alpha-value>)',
        dim:       'rgb(var(--text-dim-rgb) / <alpha-value>)',
        faint:     'rgb(var(--text-faint-rgb) / <alpha-value>)',
        green:     'rgb(var(--green-rgb) / <alpha-value>)',
        greenDeep: 'rgb(var(--green-deep-rgb) / <alpha-value>)',
        amber:     'rgb(var(--amber-rgb) / <alpha-value>)',
        red:       'rgb(var(--red-rgb) / <alpha-value>)',
        sky:       'rgb(var(--blue-rgb) / <alpha-value>)',
        /* The full-screen emergency takeover. Its own name so it can never be
           toned down by a palette tweak aimed at ordinary red text. */
        danger:    '#C1121F',
      },
      fontFamily: {
        display: ['Manrope', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl2: '20px', xl3: '28px' },
      // Tailwind's default opacity scale skips these, and an opacity modifier
      // outside the scale generates NO CSS — silently.
      opacity: { 15: '0.15', 35: '0.35', 45: '0.45', 97: '0.97' },
    },
  },
  plugins: [],
};
