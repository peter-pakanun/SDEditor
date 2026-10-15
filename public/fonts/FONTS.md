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
| Turkish | Fontin body, Fontin-SmallCaps-tr-TR smallcaps and OptimusPrincepsSemiBold-tr-TR sharp text; the preview prefers the Turkish smallcaps face when installed. |
| Thai | Kanit. |
| Japanese | Koruri Regular body; some smallcaps roles use NotoSansJP. |
| Korean | Spoqa Han Sans Neo. |
| Traditional Chinese | Noto Sans CJK TC, with Noto Sans TC as the web fallback. |
| Simplified Chinese | No XML supplied; retain the existing Noto Sans SC mapping. |

Fontin regular, bold, italic and smallcaps, Friz Quadrata and Koruri are bundled
as WOFF2. The stylesheet accepts the game's `FrizQuadrataITC` name as well as the
existing spaced aliases. Noto Serif is loaded with regular, bold and italic
variants to cover glyphs missing from bundled Latin faces. Existing Google Fonts
and Spoqa stylesheets provide the Thai, CJK and Korean web fonts.

The supplied archive does not contain `Fontin-SmallCaps-tr-TR.ttf` or
`OptimusPrincepsSemiBold-tr-TR.ttf`. Their exact typeface names are included in the
Turkish stack for installed fonts; otherwise it uses the bundled Fontin and Friz
Quadrata faces, then Noto Serif. Do not rename a generic Fontin file to pretend it
is the Turkish variant. To bundle these exact faces later, add the actual licensed
font assets and matching `@font-face` declarations.

Saved `gamePreviewFonts` language overrides continue to take precedence over
these defaults. Preview fonts do not change editor text, saved translations or
exports.
