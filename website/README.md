# DishData — Marketing Website

A self-contained marketing site for DishData (the AI restaurant intelligence product).
No build step, no dependencies — plain HTML, CSS and vanilla JS. Brand mirrors the app
(emerald → cyan on near-black, Space Grotesk display font, glassmorphism).

## Structure

```
website/
├── index.html                      # Landing: hero, why restaurants fail, efficiency,
│                                    #   features, why us, testimonials, pricing, blog, FAQ, CTA
├── features.html                   # Full feature breakdown (Operate / Grow / Money & People)
├── blog.html                       # Blog index with featured + grid
├── blog/
│   └── why-restaurants-fail.html   # Full sample article
├── css/
│   └── styles.css                  # Design system (tokens, components, responsive, animations)
└── js/
    └── main.js                     # Navbar state, mobile menu, scroll reveal, counters, FAQ
```

## Run locally

It's static — just open `index.html` in a browser, or serve the folder:

```bash
cd website
python3 -m http.server 5500
# open http://localhost:5500
```

## Interactions

- Sticky glass navbar that solidifies on scroll
- Mobile hamburger menu
- Scroll-reveal animations (IntersectionObserver)
- Animated stat counters in the "Why restaurants fail" section
- Accordion FAQ
- Animated gradient glow blobs + CSS-built product dashboard mockup
- Fully responsive (desktop → tablet → mobile) with reduced-motion support

## Deploy

Drop the `website/` folder onto any static host (Netlify, Vercel, GitHub Pages, S3, Cloudflare
Pages). No configuration required.

## Customize

All brand colors, fonts, spacing and radii are CSS variables at the top of `css/styles.css`.
Copy lives directly in the HTML.
