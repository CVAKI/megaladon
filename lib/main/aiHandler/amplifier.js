'use strict';

// ─── Request Amplifier ─────────────────────────────────────────────────────────────
// Detects short "build/create" requests and injects detailed requirements so
// the model generates large, production-grade, fully-featured code.
function amplifyRequest(text, ctx) {
  const lower = text.toLowerCase();

  // Only amplify if the request looks like a creative/build prompt
  const isBuildRequest = (
      /\b(create|build|make|generate|write|design|develop)\b/.test(lower) &&
      /\b(html|css|page|website|site|app|component|ui|landing|portfolio|dashboard|template|form|card|navbar|menu)\b/.test(lower)
  );
  const isEditRequest = (
      /\b(improve|update|fix|change|edit|modify|refactor|better|nicer|modern|beautiful|apple|like.*website|redesign|redo|restyle|upgrade|enhance|color|colour|design)\b/.test(lower) &&
      /\b(html|css|page|website|design|color|colour|look|style|ui|the.*code|the.*file|the.*page)\b/.test(lower)
  );

  if (!isBuildRequest && !isEditRequest) return text;  // pass through unchanged

  const isHTML = /\b(html|page|website|site|landing|portfolio|dashboard|template)\b/.test(lower);

  if (isHTML) {
    const appleStyle = /apple|minimal|clean|white|cupertino/.test(lower);
    const darkStyle  = /dark|night|black|neon|cyber/.test(lower);
    const colorPalette = appleStyle
        ? 'Apple-style: pure white (#ffffff) and off-white (#f5f5f7) backgrounds, SF Pro-like system fonts, crisp black text (#1d1d1f), subtle blue accents (#0071e3), generous whitespace, very subtle shadows, no gradients on primary surfaces.'
        : darkStyle
            ? 'Dark theme: deep navy/charcoal backgrounds (#0a0a14 to #1a1a2e), neon accent colors, glowing shadows, glass cards.'
            : 'Modern gradient theme: deep hero gradient (e.g. #1a1a2e \u2192 #16213e \u2192 #0f3460), vivid accent color (#e94560 or similar), frosted glass cards (backdrop-filter: blur), white text on dark areas.';

    return `${text}

[MEGALADON AGENT SPEC \u2014 MANDATORY REQUIREMENTS]
You MUST produce a single, complete, self-contained HTML file saved as @@FILE: index.html.
Minimum target: 700 lines of code. This is non-negotiable.
Do NOT truncate. Do NOT stop early. Write the FULL file.

REQUIRED SECTIONS (include all of them):
1. <head>: charset, viewport, title, Google Fonts import (Inter or Poppins), all styles inline in <style>.
2. Sticky navbar: logo/brand name on left, nav links on right, transparent with blur backdrop, becomes solid on scroll (JS scroll listener). Mobile hamburger menu with CSS-animated toggle.
3. Hero section: full-viewport-height, centered headline + subheadline + CTA button. Background: ${colorPalette} Animated floating shapes or subtle particle/blob animation using CSS keyframes.
4. Features/Services section: grid of 3\u20136 cards. Each card: icon (Unicode emoji or inline SVG), heading, description, hover lift effect (transform: translateY + box-shadow).
5. About/Stats section: horizontal stats bar (e.g., "500+ clients \u2022 10 years \u2022 99% satisfaction"), with countup animation on scroll.
6. Testimonials or Portfolio section: card carousel or grid with 3+ items, subtle border, avatar circles.
7. Contact/CTA section: full-width with gradient background, headline, email input + button.
8. Footer: multi-column layout, social links (Twitter/X, GitHub, LinkedIn \u2014 as text links), copyright, subtle top border.

STYLING REQUIREMENTS:
- CSS custom properties (--primary, --secondary, --accent, --bg, --text, --card-bg, --border, --shadow) defined in :root.
- Smooth scroll: html { scroll-behavior: smooth; }
- Intersection Observer JS: elements fade/slide in when scrolled into view (class .reveal that transitions opacity 0\u21921 and translateY 30px\u21920).
- All transitions: 0.3\u20130.5s ease.
- Responsive: @media (max-width: 768px) and @media (max-width: 480px) breakpoints.
- Buttons: gradient background, border-radius: 50px, padding: 14px 36px, hover scale(1.05).

JAVASCRIPT (inline <script> at bottom of <body>):
- Hamburger menu toggle.
- Navbar scroll effect (add .scrolled class).
- Intersection Observer for .reveal elements.
- Countup animation for stat numbers.
- (Optional) Smooth typewriter effect on hero headline.

Now write the COMPLETE index.html. Do not abbreviate. Do not use placeholders. Write every line.`;
  }

  // For non-HTML build requests, add a general quality amplifier
  return `${text}

[MEGALADON AGENT SPEC \u2014 MANDATORY]
Write the COMPLETE, production-ready implementation. No placeholders, no TODOs, no truncation.
Target: comprehensive, fully-featured code. Include full error handling, comments, and edge cases.
Do not stop early. Keep writing until the implementation is genuinely complete.`;
}

module.exports = { amplifyRequest };
