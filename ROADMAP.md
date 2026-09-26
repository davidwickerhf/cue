# Roadmap

From the product review of 26 September 2026 (Cue 0.1.1). Items are ticked as they land.

## 1. Fix now: exports, data and security

- [x] Exported keyframes are evaluated in milliseconds against thresholds in seconds, so they jump to their end value (`exporter.ts`).
- [x] A graded adjustment layer plus any audio breaks the export: the adjustment label bumps ffmpeg's input counter (`exporter.ts`).
- [x] Playback adds two event listeners per video frame (`playback.ts`).
- [x] Dropping a file outside the timeline navigates the window, and a dropped page gets `window.cue` (`main.ts`).
- [x] An edit made while autosave is writing can be lost, and saves can overlap (`store.ts`).
- [x] Quitting doesn't wait for the save to finish (`main.ts`).
- [x] ⌘Z while typing undoes a timeline edit instead of the text (`main.ts`).
- [x] ⌘C doesn't copy selected text (`useShortcuts.ts`).
- [x] The Codex chat loads the user's Codex config, hooks and MCP servers; resumed turns lose the read-only sandbox (`harness.ts`).
- [x] Agent tools can overwrite any file through `export`, `export_frame` and `save_project_as` (`controller.ts`).

## 2. Should fix

- [x] Deleting media used in another sequence breaks exports.
- [x] Nested clips keep their old audio after the sequence changes (caches keyed by id, not file).
- [x] A nested sequence's "has audio" flag is never updated.
- [x] Every audio file is decoded on open and never released.
- [x] Audio can play twice when the mix changes while a file is decoding.
- [x] Splitting an animated clip leaves keyframes, zooms and a crossfade unshifted on the right half.
- [x] OTIO import ignores media that starts at a timecode (Resolve's 01:00:00:00).
- [x] Space and Delete act on the timeline behind dialogs; held keys auto-repeat.
- [x] Video only re-syncs after 250 ms of drift.
- [x] Crossfades flash a blank frame at their start.
- [x] The inspector's "at playhead" buttons use a stale playhead.
- [x] Clicking the ruler clears the selection.
- [x] Linked audio drifts when moved past the start or when a crossfade is added.
- [x] Stopping and immediately sending in the chat can orphan the agent process.
- [x] A launch race can open two windows.
- [x] Minor: ⌥X on macOS, in/out carried between projects, ⌥-drag ignores the target track, WebGL and decoders never released, `set_in_out` and `build_proxies` report false success, `/health` 403 relaunches the bridge, `record_line` unhandled rejection, relative `import_script` paths, relink leaves stale proxies and peaks, emptied nested sequence fails export, dialogs left waiting when the window closes.

## 3. Performance

- [x] Timeline draws only visible clips (zoom at 500 clips is about 30 fps).
- [x] Leave the project out of state updates when it hasn't changed (selection, jobs, recorder).
- [ ] Send only the changed clips on an edit (still the whole project, 170 KB at 500 clips; edits take 10–35 ms).
- [x] Tune HEVC quality so it is smaller than H.264.
- [x] Trim the 460 KB stylesheet.

## 4. Standard editor features

- [x] Rubber-band selection
- [x] Resizable track heights
- [ ] Keyframe lanes and a curve editor
- [x] Waveforms on video clips
- [x] Effects library: blur, sharpen, vignette, glow, stabilisation
- [ ] More transitions: wipes, slides, zoom, blur
- [ ] Shapes and overlays: arrows, callouts, blur and redact boxes
- [ ] Picture-in-picture and split-screen layouts
- [ ] Per-track EQ and compressor
- [x] Volume line on audio clips
- [ ] Screen and camera recording
- [ ] Media bins, tags and media info
- [ ] Scene detection on import
- [x] GIF, MP3 and AAC export (social formats: see one-click variants)
- [ ] Auto-update, notarisation, Windows and Linux builds

## 5. UX and UI

- [ ] Inspector in tabs or collapsible sections
- [ ] First-run guide and a "drop footage here" empty state
- [ ] Keyboard focus for clips, the clip menu and pane dividers
- [x] Esc cancels drags and trims and restores name fields
- [ ] Viewer overlay follows keyframes, zoom and crop
- [x] Source monitor keeps its position
- [ ] Audible scrubbing while shuttling
- [ ] History panel appends instead of reloading
- [ ] Consistent shortcut labels in the inspector

## 5b. Real workspaces

Today a workspace only resizes panels and switches the sidebar tab. Each one should change what the editor is for:

- [ ] Editing: source monitor next to the viewer (two-up), media bins, full-height timeline tools
- [ ] Audio: tall audio tracks with waveforms and volume lines, the mixer docked below the viewer with meters per track, EQ and compressor in the inspector, loudness (LUFS) readout, video tracks collapsed
- [ ] Colour: scopes (waveform, vectorscope, histogram), before/after split view, a thumbnail strip of the clips on the timeline to grade shot by shot, colour tools as the whole inspector
- [ ] Voiceover: script as a teleprompter beside the viewer, takes per line, record controls and input meter always visible, the voiceover track pinned at the top
- [ ] Titles: title templates as a gallery, safe-area guides on the viewer, text tracks expanded, font preview
- [ ] Agent: chat beside the viewer, the agent's proposed edits as a reviewable list, activity and history docked
- [ ] Review: full-size viewer, markers and comments as a list, export presets
- [ ] Workspaces set the track heights, which tracks are shown, the viewer overlays and inspector sections, not just panel sizes; saved workspaces keep all of that
- [ ] Switch with ⌥1–⌥7 and from the agent (set_view)

## 6. AI and new ideas

- [ ] Edit review: agent changes arrive as proposals to accept or reject
- [ ] Alternative cuts as branches, compared side by side
- [ ] Search shots by content, on device
- [ ] Rough cut from a brief or script
- [ ] Director's notes with one-click fixes
- [ ] Voice editing
- [ ] Smart reframe that follows faces
- [ ] One-click variants (lengths and aspect ratios)
- [ ] Animated word-by-word captions
- [ ] Recipes: reusable edit templates for people and agents
- [ ] Music-driven montage
- [ ] Auto-mix: levelled dialogue and ML noise removal

## 7. Website, SEO and getting the word out

- [ ] Metadata: page title and description per section, canonical URL, Open Graph and Twitter cards with a real preview image
- [ ] Structured data: `SoftwareApplication` (name, OS, price 0, download URL, screenshots) and `FAQPage` for the FAQ
- [ ] `sitemap.xml`, `robots.txt` and `llms.txt` (so AI search can describe Cue correctly)
- [ ] Performance: poster images and lazy video on the site, Core Web Vitals checked in Vercel
- [ ] Pages people search for: "AI video editor for Mac", "open-source Premiere alternative", "edit video with Claude Code / MCP", "text-based video editing", each with a short demo
- [ ] Docs and changelog pages on the site (fresh, linkable content)
- [ ] GitHub: topics, social preview image, a short demo GIF at the top of the README, "Buy me a coffee" funding link
- [ ] Listings: MCP server directories (mcp.so, Smithery, Glama, the official MCP registry), awesome-mcp-servers, awesome-macOS, AlternativeTo, Homebrew cask
- [ ] Launches: Show HN, Product Hunt, r/VideoEditing, r/macapps, r/ClaudeAI and r/LocalLLaMA (local models), Mastodon and X with short Recordly demo clips
- [ ] A launch post on wicker.life: why an editor an agent can drive, with the demo videos
