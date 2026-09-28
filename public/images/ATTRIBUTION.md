# Image attribution & replacement instructions

This demo build uses placeholder photography served live from **Lorem Picsum**
(`https://picsum.photos/seed/...`) for:

- The two "travelers enjoying their trip" photos near the bottom of the home page.
- Destination inspiration cards.
- The featured flight+stay package hero image.
- Demo stay property photos.

Lorem Picsum images are randomly sourced stock photography suitable for
placeholders during development, but they are **not licensed for this specific
commercial use** and must be replaced before any real/production launch.

## Before going live, replace these with:

1. Licensed stock photography (e.g. a paid subscription to Unsplash+,
   Getty Images, Adobe Stock, or similar) with a license that covers
   commercial travel-marketing use, **or**
2. Original photography TyJen Travel / the host agency owns the rights to.

## Where to make the swap

- Home page hero/travelers photos: `src/http/routes/pages.home.ts` (search for `picsum.photos`).
- Destination cards: seeded in `src/seed.ts` (`featured_destinations` table) — update the `image_url` values or replace via Admin once a content-management screen is built.
- Stay property photos: seeded in `src/seed.ts` (`stay` seed calls) — replace with real supplier-provided photos once a live stays adapter is connected (supplier APIs typically provide licensed photo URLs directly).

Every placeholder image in the running app also carries a visible caption or
alt text noting it is a placeholder, so nothing is presented as a real,
licensed photo by mistake.
