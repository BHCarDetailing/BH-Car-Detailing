# BH Car Detailing — Website V2

Premium black/white/silver redesign. Static HTML/CSS/JS — no build step, deploys anywhere (Netlify, Vercel, GitHub Pages, any host).

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Main site — hero, services + pricing, package recommender, gallery, ceramic, why BH, process, reviews, areas, Instagram, booking |
| `ceramic-coating.html` | Dedicated ceramic page ($750) with comparison table |
| `paint-correction.html` | Dedicated correction page ($550) with before/after slider |
| `areas/*.html` | Local SEO landing pages: Miami, Miami Beach, Coral Gables, Fort Lauderdale, Boca Raton |

## Things to do before launch

1. **Lead forms** — all forms POST to [Formspree](https://formspree.io) (`https://formspree.io/f/xlgapllq`) and submit via AJAX (no redirect off-site; inline success/error message). Make sure that Formspree form ID is connected to the right inbox in the Formspree dashboard.
2. **Photos** — all images are Unsplash placeholders. Replace with your own work (especially gallery + before/afters). Keep them large; compress to WebP.
3. **Hero video** — drop your footage at `assets/hero.mp4` and uncomment the `<video>` block in `index.html` (search for `hero.mp4`).
4. **Reviews** — the testimonial cards are placeholder copy. Swap in real Google reviews (names + vehicles).
5. **10% off popup** — appears 1.8s after landing, once per visitor per 7 days. Code lives in `index.html` (`#promo-modal`) and `js/main.js`.

## Adding a new service-area page

Edit `areas/generate.ps1` — add a city block to the `$cities` array (slug, name, headline, neighborhoods, two intro paragraphs) — then run the script. It fills `areas/_template.html` and writes the page.

## Previewing locally

Open `index.html` directly in a browser, or run any static server from this folder. `.claude/serve.ps1` is a dependency-free PowerShell server (http://localhost:4173) if you ever need one — note PowerShell's execution policy may need to allow local scripts.
