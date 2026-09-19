# Landmark asset naming

Folder: `assets/landmarks/<landmark-slug>/`

Required files:
- `<landmark-slug>_question.webp`
- `<landmark-slug>_fact-<fact-slug>.webp`
- `manifest.json`

Example:
- `eiffel-tower_question.webp`
- `eiffel-tower_fact-thermal-expansion.webp`

Rules:
- lowercase ASCII
- hyphens inside names/slugs
- `_question` and `_fact-...` identify asset role
- WebP for generated raster images
- no version numbers in approved production filenames
