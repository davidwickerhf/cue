# Cue asset library

`catalog.json` is the shared app and website catalog. The thirty-one stock videos are credited to their individual Mixkit source pages and use the linked [Mixkit Stock Video Free License](https://mixkit.co/license/modal/videoFree/). Each new source page and 720p URL was checked when added. Cue stores only its own edited, short style studies in the repository. The full stock files download from Mixkit when someone imports an asset into a project. Review the linked license and source before publishing a finished video.

`original/` contains two Cue-created starting graphics. The cartographic grid is illustrative rather than geographically accurate; the document page is a layout study. Replace placeholder marks and text with verified material in any factual edit.

Run `python3 scripts/build-style-previews.py` from the repo root to regenerate the style studies and posters. It needs Pillow and FFmpeg. Stock source downloads are cached in the ignored `.cache/style-stock/` directory. It writes matching preview files for the desktop app and website.

Styles and source references are in `resources/styles/catalog.json`. They take inspiration from editing patterns shown in Remotion, Motion Array, and Mixkit galleries. The layouts, graphics, script, and short preview edits here were created for Cue; no third-party templates were repackaged.
