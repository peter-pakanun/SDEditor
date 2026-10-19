# Game preview fonts

The preview stacks in `public/index.js` use the language settings from the supplied
2026-10-15 PoE2 `UI Files.zip`. These XML files describe fonts; they contain no font
binaries. The preview uses one language stack for both StatDescriptions and
ClientText, rather than reproducing every game UI element's font and size.

| Language | Font settings in the supplied XML |
| --- | --- |
| French, German, Portuguese | No root Normal font override; inherit the default Fontin body. Several UI elements explicitly use Fontin Smallcaps. French and Portuguese list FrizQuadrataITC as a fallback. |
| Polish | Empty language override; retain the default Fontin body. |
| Russian | No root Normal font override; retain the default Fontin body. Caveat overrides apply to handwriting and specific UI elements. |
| Spanish | Fontin body and Fontin Smallcaps; keep the existing smallcaps preview preference. FrizQuadrataITC is a fallback. |
| Turkish | Fontin body, Fontin-SmallCaps-tr-TR smallcaps and OptimusPrincepsSemiBold-tr-TR sharp text; the preview prefers the Turkish smallcaps face when the font API or browser font cache is available. |
| Thai | Kanit. |
| Japanese | Koruri Regular body; some smallcaps roles use NotoSansJP. |
| Korean | Spoqa Han Sans Neo. |
| Traditional Chinese | Noto Sans CJK TC, with Noto Sans TC as the web fallback. |
| Simplified Chinese | No XML supplied; retain the existing Noto Sans SC mapping. |

Fontin regular, bold, italic and smallcaps, Friz Quadrata and Koruri, plus the
user-supplied exact Turkish TTFs, live in the private SDEditor API repository.
There are no font binaries or static public font downloads in this frontend.
The owner explicitly allows public read-only access to every preview font,
regardless of sign-in, account role or assigned language. `previewFonts.js` uses
native CORS font URLs from the API, without a cloud client, bearer headers or
authenticated media requests. FontFace instances and normal HTTP caching avoid
repeat downloads when accounts, permissions or preview languages change.
Loaded fonts remain available in offline/local test sessions; new uncached
fonts need a reachable API, and reconnecting retries failed loads.

This font-only exception does not change access to image/audio assets or
private APIs. Those resources retain their existing authenticated lifecycle.

Turkish smallcaps uses `Fontin-SmallCaps-tr-TR`. The exact
`OptimusPrincepsSemiBold-tr-TR` sharp face is available in preview overrides.
Both include ÇçĞğİıÖöŞşÜü. Optimus has no ASCII `^ | ~` glyphs; its overrides
retain Turkish Fontin, Fontin and Noto Serif as CSS fallbacks. Font selection
does not alter protected tokens or parse font tags into new preview semantics.

Web/system CSS fallbacks remain available if a font is not cached and the API
cannot be reached. Google Fonts and Spoqa provide the existing Thai, CJK, Korean
and Noto Serif fallback faces. Font bytes use the browser's ordinary HTTP cache;
they do not enter translation workspaces, exports or IndexedDB.

Deploy the matching API first, then the frontend. Reload open tabs after release;
do not clear IndexedDB or change installed system fonts. The API checkout carries
the original Koruri license alongside its font asset.

Saved `gamePreviewFonts` language overrides continue to take precedence over
these defaults. ClientText previews use the open workbook's language, including
Test Sheet Offline sessions whose language differs from Settings. StatDescription
previews use the selected Settings language; English previews use their own stack.
Preview fonts do not change editor text, saved translations or exports.
