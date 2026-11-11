# Brand packs

A brand pack rebrands a build without changing code. Select one at image build time:

```bash
docker build -f docker/Dockerfile \
  --build-arg BRAND=<name> \
  --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" .
```

With no `BRAND` the image is upstream Documenso, unchanged.

## What a pack holds

```
brand/<name>/
  public/              copied over apps/remix/public/
    brand/brand.json   names and email colors (validated at startup)
    brand/brand.css    palette overrides, loaded after the app stylesheet
    brand/logo-light.svg, logo-dark.svg, icon-light.svg, icon-dark.svg
    favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png,
    android-chrome-192x192.png, android-chrome-512x512.png, site.webmanifest,
    opengraph-image.jpg, static/logo.png (emails and PDF footers)
  assets/              copied over packages/assets/ (logo.png, logo_icon.png)
```

`brand.json`:

```json
{
  "name": "Example Co",
  "legalName": "Example Co, Inc.",
  "companyDetails": "Optional postal line for email footers",
  "emailColors": { "primary": "#112233", "primaryForeground": "#ffffff" }
}
```

Packs never hold domains, tenant identifiers or secrets. Addresses come from the environment:
`NEXT_PUBLIC_BRAND_WEBSITE_URL` for the brand's site and `NEXT_PUBLIC_SOURCE_REPOSITORY_URL`
for the public source.

## License obligations

A branded server refuses to start unless `NEXT_PUBLIC_SOURCE_REPOSITORY_URL` and the baked
`SOURCE_COMMIT` are set. Every page then links that exact source, as AGPL-3.0 section 13
requires. Build only from a commit that is pushed to the public repository.
