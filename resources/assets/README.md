# Cue asset library

`catalog.json` is the shared app and website catalog. The thirty-one stock videos are credited to their individual Mixkit source pages and use the linked [Mixkit Stock Video Free License](https://mixkit.co/license/modal/videoFree/). Each new source page and 720p URL was checked when added. Cue stores only its own edited, short style studies in the repository. The full stock files download from Mixkit when someone imports an asset into a project. Review the linked license and source before publishing a finished video.

`original/` contains three Cue-created graphics. The cartographic grid is illustrative rather than geographically accurate; the document page is a layout study. Replace placeholder marks and text with verified material in any factual edit. The transparent halftone veil can be placed above footage as a print texture; its catalog poster shows it over a stock shot.

Run `python3 scripts/build-style-previews.py` from the repo root to regenerate the style studies and posters. It needs Pillow and FFmpeg. Stock source downloads are cached in the ignored `.cache/style-stock/` directory. It writes matching preview files for the desktop app and website.

Styles and source references are in `resources/styles/catalog.json`. They take inspiration from editing patterns shown in Remotion, Motion Array, and Mixkit galleries. The layouts, graphics, script, and short preview edits here were created for Cue; no third-party templates were repackaged.

## Textures

`textures/` holds the Textures category. Every entry in `catalog.json` records its licence, source page, the exact source file and a credit line. Each entry also has a `use` field that agents follow: the blend mode, opacity, track (bottom for boards, top for overlays) and a short note.

- Paper and card (`paper-off-white`, `paper-crumpled`, `paper-kraft`, `cardboard-ribbed`, `paper-newsprint`, `paper-construction-yellow`) are the colour maps of ambientCG materials Paper001, Paper003, Paper006, Paper004 and Paper002. They are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (see https://docs.ambientcg.com/license/). Each is cropped to 1920×1080 and colour-matched; the construction paper is Paper001 recoloured yellow.
- `film-dust.mp4`, `light-leak.mp4`, `halftone-screen.png` and `vignette.png` are Cue originals, generated procedurally.

Run `node scripts/build-textures.mjs` to rebuild them and their posters. It needs FFmpeg and caches downloads in `.cache/textures/`.

## Sound effects

`sounds/` holds the Sound effects category.

- The paper slaps, rustle and flick come from Kenney's [RPG Audio](https://kenney.nl/assets/rpg-audio) pack. The two impacts come from [Impact Sounds](https://kenney.nl/assets/impact-sounds) and the tick from [Interface Sounds](https://kenney.nl/assets/interface-sounds). All three packs are CC0 1.0. The files were trimmed and loudness-matched.
- The whooshes, riser, camera shutter, typewriter key and burst, pop, title chime and room tone are Cue originals, synthesised by the script.

One-shot sounds peak at about −16 LUFS momentary (around −18 LUFS short-term in an edit), with a true peak under −1 dBFS where the source allows. Room tone sits at −40 LUFS integrated, so it fills silence without being noticed. `use.syncMs` marks the moment to line up with the event, such as a whoosh's peak; `import_library_asset {atMs}` uses it.

Run `node scripts/build-sfx.mjs` to rebuild them and their waveform posters. It needs FFmpeg and caches the Kenney packs in `.cache/sfx/`.
