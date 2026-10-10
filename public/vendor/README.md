# Browser XML dependency

`fast-xml-parser-5.11.2.min.js` is the unmodified Fast XML Parser 5.11.2 browser build (`lib/fxparser.min.js`) from the official npm package, downloaded from:

https://cdn.jsdelivr.net/npm/fast-xml-parser@5.11.2/lib/fxparser.min.js

SHA-256: `c53edb2c88ad4c14bce3d56f0706c5776f0c08284e677f50de899713120f8b19`.

Its MIT license is retained in `fast-xml-parser-LICENSE.txt`. This build exposes the parser constructor as `XMLParser.default`; `clientTextCodec.js` adapts that browser export and the CommonJS export. No build step is required.
