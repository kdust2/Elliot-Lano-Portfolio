# Elliot Lano — Cinematic Frontend Developer Portfolio

A minimalist, editorial, multi-page portfolio engineered with cinematic scroll motion, a scroll-driven frame sequence, dark/light theme switching with the View Transitions API, and zero external build runtime requirements.

---

## 1. File Tree

```
├── index.html                 # Home: Cinematic hero, scroll sequence, work teaser, about, services, marquee, CTA
├── about.html                 # About: Narrative story bio, milestones timeline, technical & soft skills
├── work.html                  # Work: Showcase of all three case studies with hover previews
├── project-star.html          # Case study: STAR International Preparatory JHS (school platform)
├── project-treasure.html      # Case study: Treasure International School (vanilla static architecture)
├── project-elite-touch.html   # Case study: Elite Touch Collections (fashion e-commerce + WhatsApp checkout)
├── services.html              # Services: What I offer + 4-phase process (Discover, Design, Build, Launch)
├── contact.html               # Contact: Validated intake form (mailto/Formspree ready), email, GitHub
├── 404.html                   # Custom on-brand error page
├── robots.txt                 # Search engine crawler permissions
├── sitemap.xml                # SEO index of all pages
├── css/
│   └── styles.css             # Unified CSS tokens, typography, dark/light themes, animations, layouts
├── js/
│   ├── theme.js               # Dark/light mode switcher, View Transitions API circular wipe, persistence
│   ├── scroll.js              # Lenis smooth scrolling engine synced to GSAP ScrollTrigger ticker
│   ├── sequence.js            # Scroll-driven frame sequence engine (canvas, preloading, HUD, procedural fallback)
│   ├── animations.js          # GSAP scroll reveals, clip-path image wipes, kinetic velocity marquee
│   ├── cursor.js              # Magnetic cursor (dot + trailing ring) for fine pointer devices
│   ├── transitions.js         # Smooth multi-page curtain transitions
│   └── main.js                # App orchestrator (preloader lifecycle, mobile drawer, form validation)
├── frames/
│   ├── frame_0001.webp ... frame_0120.webp   # 120 desktop sequence frames
│   └── mobile/
│       ├── frame_0001.webp ... frame_0060.webp # 60 mobile sequence frames
└── images/
    ├── favicon.svg            # Custom EL monogram SVG favicon
    ├── star-preview.webp      # STAR International Preparatory mockup
    ├── treasure-preview.webp  # Treasure International School mockup
    └── elite-preview.webp     # Elite Touch Collections mockup
```

---

## 2. Running Locally

### Option A: Pure Static Server (Zero build tool dependencies)
Because the codebase is written in vanilla HTML5, CSS3, and ES modules:
```bash
# Python 3 built-in HTTP server:
python3 -m http.server 8000

# Or with Node's npx serve:
npx serve .
```
Open [http://localhost:8000](http://localhost:8000) in your browser.

### Option B: Vite Dev Server
```bash
npm install
npm run dev
```

---

## 3. Deploying to GitHub Pages or Netlify

### Deploying to GitHub Pages
1. Push this repository to GitHub (e.g. `https://github.com/kdust2/portfolio`).
2. Go to your repository settings: **Settings** &rarr; **Pages**.
3. Under **Build and deployment** &rarr; **Source**, select **Deploy from a branch**.
4. Set the branch to `main` (or `master`) and folder to `/ (root)`.
5. Click **Save**. Your site will be live at `https://kdust2.github.io/portfolio/` within minutes.

### Deploying to Netlify
1. Connect your repository to Netlify or drag and drop this project folder onto Netlify Drop.
2. Build command: leave empty (or `npm run build` if you wish to serve from `dist`).
3. Publish directory: `.` (or `dist`).

---

## 4. Swapping Screenshots & Profile Photo

### Profile Photo
- Place your photo file at `/images/elliot.jpg`.
- In `about.html` and `contact.html`, locate the `<!-- REPLACE: Profile photo if available (/images/elliot.jpg) -->` comment.
- Replace the monogram fallback circle:
  ```html
  <img src="/images/elliot.jpg" alt="Elliot Lano" class="about-photo-img" style="width: 320px; height: 320px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-medium);" />
  ```

### Project Mockups & Screenshots
- Replace `/images/star-preview.webp`, `/images/treasure-preview.webp`, and `/images/elite-preview.webp` with real full-page browser screenshots (recommended dimension: 1280x800 or 1440x900).

---

## 5. Editing Colors and Fonts

All design tokens are centralized at the very top of `/css/styles.css`:

```css
:root {
  /* Change the accent color (deep blue, emerald, amber, etc.) */
  --accent: #2B4BFF;
  --accent-rgb: 43, 75, 255;
  --accent-hover: #1936D9;

  /* Font pairings */
  --font-display: 'Space Grotesk', sans-serif;
  --font-heading-accent: 'Bebas Neue', sans-serif;
  --font-sans: 'Inter', 'DM Sans', sans-serif;
  --font-body: 'DM Sans', 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

[data-theme="dark"] {
  /* Dark mode accent (tuned for high contrast on black) */
  --accent: #4D6DFF;
  --accent-rgb: 77, 109, 255;
}
```

To switch Google Fonts, update the `@import url('...')` declaration on line 6 of `/css/styles.css`.

---

## 6. Live Project Deployments

- **STAR International Preparatory JHS**: [http://kdust2.github.io/STAR-INTERNATIONAL-PREPARATORY-JHS/](http://kdust2.github.io/STAR-INTERNATIONAL-PREPARATORY-JHS/)
- **Treasure International School**: [https://kdust2.github.io/Treasure-International-School/](https://kdust2.github.io/Treasure-International-School/)
- **Elite Touch Collections**: [https://kdust2.github.io/Elite-Touch-Shop/](https://kdust2.github.io/Elite-Touch-Shop/)

---

## 7. Generating Sequence Frames from a Video with FFmpeg

If you record a 3D interface animation, code interaction, or screen walkthrough, you can generate the exact WebP image sequence using `ffmpeg`:

### Step 1: Desktop Frames (120 frames, 960x540 or 1280x720)
```bash
# Extract exactly 120 frames from a video file input.mp4:
ffmpeg -i input.mp4 -vf "scale=960:540,fps=120/DURATION_IN_SECONDS" -c:v libwebp -lossless 0 -q:v 85 frames/frame_%04d.webp
```
*Tip: If your clip is 4 seconds long, `fps=30` will produce exactly 120 frames (`frame_0001.webp` through `frame_0120.webp`).*

### Step 2: Mobile Frames (60 frames, 540x960 portrait)
```bash
ffmpeg -i input.mp4 -vf "scale=540:960,fps=60/DURATION_IN_SECONDS" -c:v libwebp -lossless 0 -q:v 85 frames/mobile/frame_%04d.webp
```

---

## 7. Checklist of `<!-- REPLACE -->` and `[ADD ...]` Placeholders

Here is the exhaustive checklist of every placeholder in the project ready for your real data:

### In `index.html`:
- [ ] `<!-- REPLACE: Profile photo if available (/images/elliot.jpg) -->` (About section avatar)

### In `about.html`:
- [ ] `<!-- REPLACE: Profile photo if available (/images/elliot.jpg) -->` (Main bio avatar)

### In `contact.html`:
- [ ] `<!-- REPLACE: Profile photo if available (/images/elliot.jpg) -->` (Contact card avatar)
- [ ] Formspree endpoint (optional): Update `action="https://formspree.io/f/YOUR_FORMSPREE_ID"` if you prefer Formspree over the default `mailto:` fallback.

### In `project-star.html` (STAR International Preparatory JHS):
- [ ] `[ADD URL]`: Replace placeholder live link button with actual production domain (if deployed)
- [ ] `[ADD METRIC]`: Reduction in Admissions Phone Call Volume (e.g. 40% reduction)
- [ ] `[ADD METRIC]`: Lighthouse Performance Score (e.g. 98/100)
- [ ] `[ADD RESULT]`: Parent inquiries and real-world feedback metric

### In `project-treasure.html` (Treasure International School):
- [ ] `[ADD URL]`: Replace placeholder live link button with actual production domain (if deployed)
- [ ] `[ADD RESULT]`: Parent engagement rate & admissions inquiries metric

### In `project-elite-touch.html` (Elite Touch Collections):
- [ ] `[ADD URL]`: Replace placeholder live link button with actual production domain (if deployed)
- [ ] `[ADD RESULT]`: Monthly WhatsApp orders & conversion rate metric
