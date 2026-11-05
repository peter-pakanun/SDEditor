# Social link previews

The editor and privacy page include static [Open Graph](https://ogp.me/) metadata and `summary_large_image` cards. Crawlers can read these directly without running the app or signing in.

- Public origin: `https://sdeditor.pages.dev`. Update both pages' canonical, `og:url` and image URLs if this changes.
- Image: `public/social-preview.jpg`, 1200 × 630, JPEG. Both pages share it. Deploy it together with the HTML; these local changes do not update hosted previews.
- Existing favicons are linked directly; no new runtime dependencies or server configuration are needed.

## Artwork source

Generated with the built-in imagegen tool using `public/android-chrome-512x512.png` as the reference, then resized and JPEG-encoded for delivery. The only image text is “SDEditor”.

Final generation prompt:

> Use case: ads-marketing. Asset type: social link-preview banner for SDEditor, especially Discord. Create a clean wide landscape image with a 1200:630 aspect ratio. Input image 1 is the existing SDEditor app icon and is the brand reference: faithfully retain its interlocking silver-white S and D letterforms, diagonal silver quill/pen, fine compass-like circular blue ornament and midnight-navy palette. Place this recognizable icon large in the left half, with a restrained soft blue glow. On the right set only the exact text "SDEditor" in large elegant, highly readable silver-white typography, with ample breathing room. Background: deep midnight navy, subtly illuminated blue, very restrained fine grain and no distracting decoration. Keep everything comfortably inside generous margins for preview cropping. Polished, quiet, desktop software brand artwork; excellent legibility when reduced to a Discord embed. Constraints: no other words, no tagline, no URLs, no UI screenshot, no badges, no watermark, no extra logos; do not invent or change the emblem.
