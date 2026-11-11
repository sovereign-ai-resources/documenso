# SOAR AI brand pack

Selected with `docker build --build-arg BRAND=soar`. See `../README.md` for how packs work.

The SOAR AI name, logos and marks are trademarks of SOAR AI, Inc. They are published here because
files baked into the image are part of its Corresponding Source; publishing them grants no right
to use them to identify any other service.

## Contents

| File | Source |
|---|---|
| `public/brand/logo-light.svg`, `logo-dark.svg` | Word mark, Dust and White, from the brand guidelines |
| `public/brand/icon-light.svg`, `icon-dark.svg` | The star from the website favicon, filled Steel and white |
| `public/brand/brand.json` | Names and email colors |
| `public/brand/brand.css` | App palette: Dark `#0C0E12`, Steel `#212732`, Horizon `#768FB5`, Sky `#9BBCED` |
| `public/favicon*`, `apple-touch-icon.png`, `android-chrome-*` | Rendered from the star |
| `public/static/logo.png`, `assets/logo.png` | Word mark (Dust) for emails, PDF footers and the mobile nav |
| `assets/logo_icon.png` | The star |
| `public/opengraph-image.jpg` | Full white logo on a Dark-to-Sky gradient |

Type stays Inter. The display face used on the marketing site is licensed per website and is not
used here.

## Regenerating rasters

Render the SVGs with `sharp` (already a dependency): the star at 16, 32 and 48 px for
`favicon.ico` and the PNG favicons, 180/192/512 px on white with 14% padding for the home-screen
icons, and the word mark at 110 px tall (`public/static/logo.png`) and 320 px tall
(`assets/logo.png`).
