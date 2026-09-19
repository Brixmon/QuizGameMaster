# QuizGameMaster visual safe zones

These rules apply when generating future question and fact images for the game.

## Core rule
Important content must survive both HTML overlays and responsive cropping. Do not place the main subject, key label, answer clue, face, landmark detail, or infographic headline near the edges or under the leaderboard overlay.

## Question / Fact hero images
- Keep the primary subject in the center or slightly left of center.
- Leave the upper-right area visually expendable because ROUND TOP 5 occupies that zone.
- Treat roughly the outer 12–15% on both left and right edges as crop/bleed area.
- Keep critical text and labels inside the central ~70% of the image.
- Avoid tiny text baked into generated images; HTML should carry important readable text whenever possible.
- For infographics, place the main information center-left or lower-center, not upper-right.
- Background detail may extend under the Top 5 panel; critical detail may not.
- Generate with extra visual bleed around all sides because the hero uses object-fit: cover.
- Do not bake leaderboard, badges, rank UI, timers, or answer UI into generated images. Those are HTML overlays.

## Composition preference
Main subject: center-left.
Secondary decoration: edges and upper-right.
Critical labels: central safe area.
Top-right: background-only whenever possible.
