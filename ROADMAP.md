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
- [x] Send only the changed clips on an edit (a patch against the window's version: 0.2–4 KB instead of 170 KB at 500 clips; unchanged clips keep their identity in the renderer).
- [x] Tune HEVC quality so it is smaller than H.264.
- [x] Trim the 460 KB stylesheet.

## 4. Standard editor features

- [x] Rubber-band selection
- [x] Resizable track heights
- [ ] Keyframe lanes and a curve editor
- [x] Waveforms on video clips
- [x] Effects library: blur, sharpen, vignette, glow, stabilisation
- [x] More transitions: wipes, slides, zoom, blur
- [x] Shapes and overlays: arrows, callouts, blur and redact boxes
- [x] Picture-in-picture and split-screen layouts
- [x] Per-track EQ and compressor (with Voice and Music bed presets, in the mixer and update_track)
- [x] Volume line on audio clips
- [x] Screen and camera recording (Record dialog, ⇧⌘R, record_screen)
- [x] Media bins, tags and media info
- [x] Scene detection (split at shot changes, from the clip menu or split_at_scenes)
- [x] GIF, MP3 and AAC export (social formats: see one-click variants)
- [ ] Auto-update, notarisation, Windows and Linux builds

## 5. UX and UI

- [x] Inspector in tabs or collapsible sections
- [x] First-run guide and a "drop footage here" empty state
- [x] Keyboard focus for clips, the clip menu and pane dividers
- [x] Esc cancels drags and trims and restores name fields
- [x] Viewer overlay follows keyframes, zoom and crop
- [x] Source monitor keeps its position
- [x] Audible scrubbing while shuttling
- [x] History panel appends instead of reloading
- [x] Consistent shortcut labels in the inspector

## 5b. Real workspaces

Today a workspace only resizes panels and switches the sidebar tab. Each one should change what the editor is for:

- [x] Editing: source monitor next to the viewer (two-up, with its own transport, in/out marks, insert and overwrite, and drag to the timeline), media bins
- [x] Colour: a clip strip to grade shot by shot (copy and paste grades, match the previous shot, copy_grade for agents), split-screen before/after with a draggable divider
- [x] Audio: tall audio tracks with waveforms and volume lines, the mixer docked beside the viewer with meters per track, video tracks low (EQ, compressor and LUFS readout: see section 4)
- [x] Colour: scopes (waveform, vectorscope, histogram), hold-to-compare before/after, colour tools open in the inspector
- [x] Voiceover: script as a teleprompter beside the viewer, takes per line, record controls and input meter always visible, the voiceover track pinned at the top
- [x] Titles: title templates as a gallery, safe-area guides on the viewer, text tracks expanded, font preview
- [x] Agent: chat beside the viewer, the agent's proposed edits as a reviewable list, activity and history docked
- [x] Review: full-size viewer, markers and comments as a list, export presets
- [x] Workspaces set the track heights, which tracks are shown, the viewer overlays and inspector sections, not just panel sizes; saved workspaces keep all of that
- [x] Switch with ⌥1–⌥7 and from the agent (set_view)

## 6. AI and new ideas

- [x] Edit review: agent changes arrive as proposals to accept or reject
- [x] Alternative cuts as branches, compared side by side (branch_sequence, promote_branch, and an A/B compare above the timeline that flips with ` at the same playhead)
- [x] Search shots by content, on device (Apple Vision labels, on-screen text, faces and transcripts)
- [x] Rough cut from a brief or script (rough_cut: on-device word matching against transcripts, with a confidence per line)
- [x] Director's notes with one-click fixes
- [x] Voice editing (hold the mic button in the Agent panel and say what to change)
- [x] Smart reframe that follows faces (follow_faces, and variants with followFaces)
- [x] One-click variants (lengths and aspect ratios)
- [x] Animated word-by-word captions
- [x] Recipes: reusable edit templates for people and agents
- [x] Music-driven montage (beat_montage: cuts on every 1, 2 or 4 beats, fresh shots first, push-ins on stills)
- [x] Auto-mix: levelled dialogue and ML noise removal (auto_mix and the mixer's Auto-mix and LUFS readout; per-clip denoise Off / Light / Voice (ML) with RNNoise, heard in the preview too)

## 7. Website, SEO and getting the word out

- [x] Metadata: page title and description per section, canonical URL, Open Graph and Twitter cards with a real preview image
- [x] Structured data: `SoftwareApplication` (name, OS, price 0, download URL, screenshots) and `FAQPage` for the FAQ
- [x] `sitemap.xml`, `robots.txt` and `llms.txt` (so AI search can describe Cue correctly)
- [x] Performance: poster images and lazy video on the site, Core Web Vitals checked in Vercel
- [x] Pages people search for: "AI video editor for Mac", "open-source Premiere alternative", "edit video with Claude Code / MCP", "text-based video editing", each with a short demo
- [x] Changelog page on the site
- [x] Docs pages on the site
- [x] Funding link (Ko-fi) on GitHub, the README, the site and the app
- [ ] GitHub: topics, social preview image, a short demo GIF at the top of the README
- [ ] Listings: MCP server directories (mcp.so, Smithery, Glama, the official MCP registry), awesome-mcp-servers, awesome-macOS, AlternativeTo, Homebrew cask
- [ ] Launches: Show HN, Product Hunt, r/VideoEditing, r/macapps, r/ClaudeAI and r/LocalLLaMA (local models), Mastodon and X with short Recordly demo clips
- [ ] A launch post on wicker.life: why an editor an agent can drive, with the demo videos
