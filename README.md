# Cue

An AI-centred video editor for macOS. You can edit by hand like in any non-linear editor, or an agent (Claude Code or any MCP client) can drive the same project: cut, caption, generate voice, record with you, check frames and export. Every change is attributed to *you* or *agent* and can be undone.

It grew out of a voiceover booth: a script sits on the timeline as timed lines, you record takes against a teleprompter, and the best take per line is placed on the voiceover track.

## What it does

- **Timeline**: video, audio and text tracks (mute, lock, hide, volume, reorder). Move clips across tracks, trim and extend both edges within the source, blade and split, ripple delete, duplicate, snapping, markers, J/K/L, in/out points, zoom.
- **Clips**: speed, volume, fades, noise reduction, position, scale, opacity, crop. Detach a video's audio onto its own track.
- **Text**: titles, lower thirds, captions and labels. Font, colour, box, alignment, layout and in/out animations (fade, pop, slide, typewriter). The same canvas code draws the preview and the export, so they match.
- **Voiceover**: script lines with target and maximum length, recording with pre-roll, teleprompter and auto-stop, speech detection and trimming, several takes per line with fit status, SRT/JSON script import.
- **Audio**: waveforms, per-clip and per-track gain, music that ducks under the voiceover (a sidechain compressor on export), loudness normalisation.
- **Generate** (OpenAI; the key is stored encrypted in the keychain): text-to-speech takes, captions from speech, a script from existing narration, still images.
- **Clean-up**: remove pauses in the speech across every track, keeping everything in sync.
- **Export**: H.264, HEVC or ProRes (hardware encoding on macOS), output scale, quality presets. Also per-line WAV stems with `durations.json`, the voiceover track, the full mix, and SRT/VTT captions.
- **Agents**: 60+ MCP tools, generated from one contract that the UI uses too. `render_frame` returns a PNG of any moment so an agent can look at its edit, and `record_line` rolls a take with the user.

## Architecture

```
electron/core/      Pure TypeScript, tested with vitest
  types.ts          Project model: assets, tracks, clips, script lines, settings
  ops.ts            Every edit as a validated operation (zod) → new project state
  store.ts          Open project, undo/redo, autosave, activity feed, media jobs
  exporter.ts       ffmpeg filter graphs for video, mixes, stems and captions
  media.ts / ai.ts  ffmpeg helpers (probe, speech/silence detection, peaks, thumbnails), OpenAI calls
electron/control/
  contract.ts       The agent API: names, descriptions, zod input schemas
  server.ts         Loopback JSON-RPC with a per-launch token (control.json, mode 600)
electron/controller.ts  Implements the contract, used by both the window (IPC) and agents
electron/main.ts    Window, cue-media:// protocol with range requests, keychain, menus
mcp/cue-mcp.ts      stdio MCP bridge: finds or launches the app and exposes the contract as tools
src/                React 19 + HeroUI v3 + Tailwind v4 editor (Recordly-style stack)
  lib/playback.ts   Web Audio scheduling, video layers per track, canvas text
  lib/recorder.ts   Microphone, level meter, take recording aligned to the timeline
```

The layout and toolchain follow [Recordly](https://github.com/webadderallorg/Recordly) (Electron, Vite, React, HeroUI, Tailwind, electron-builder). No Recordly code is copied; Recordly is AGPL-3.0.

## Develop

```sh
npm install
npm run dev          # Vite + Electron with reload
npm test             # core tests, including real ffmpeg renders
npm run typecheck
npm run package      # release/mac-arm64/Cue.app (then: codesign --force --deep --sign - …)
```

Connect an agent (the app shows this command in the Agent panel):

```sh
claude mcp add --scope user cue -- node /Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs
```

Try tools from the terminal with `node scripts/mcp-call.mjs list`.

## Project files

A project is a `.cueproj` file: plain JSON, so it diffs and versions well, and double-clicking one opens Cue. Older `.cue.json` projects still open. Takes go in `takes/`, generated media in `generated/`, and caches (waveforms, thumbnails, proxies, the overview poster, rendered text) in `.cue-cache/` next to it. Media paths are stored relative to the project when possible. New projects get their own folder in `~/Movies/Cue` (changeable in Settings), and the projects overview lists everything there plus recent projects.

If media moves, Cue looks for it when the project opens: first where it would be if the project folder moved together with it, then for a file with the same name and size near the project. Anything still missing shows as offline with a Relink option; locating one file also finds the others in the same folder.

## History

Every change to a project is kept, with who made it (you, an agent, or Cue) and when, in a hidden `.cue-history` folder next to the project (ignored by git). The History panel lists it all, across sessions; clicking a step brings the project back to that point, as a new step you can undo.

## Agent chat

The Agent panel chats with Claude Code, Codex or Gemini CLI, whichever is installed, signed in with your own account. Each run gets only Cue's tools (no shell, files or web), knows the playhead and selection, and keeps its session between messages. Outside agents can still connect over MCP (Agent → Connect & activity).

## Working with other editors

File → Export Timeline (or the Export menu, or the `export` agent tool) writes the edit for another editor, linking the original media:

| Format | Opens in | Carries |
| --- | --- | --- |
| OpenTimelineIO `.otio` | DaVinci Resolve, Premiere (plug-in), Kdenlive, Avid | Tracks, cuts, speed, titles as generators, markers, plus Cue's clip settings in metadata |
| FCPXML 1.10 `.fcpxml` | Final Cut Pro, DaVinci Resolve | Tracks as lanes, cuts, speed, volume, Basic Title text, markers |
| MLT XML `.mlt` | Shotcut | Tracks, cuts, speed, volume, text as dynamic text, mute and hide |
| CMX3600 `.edl` | Almost anything | The main video track and two audio tracks |

File → Import Timeline brings an OpenTimelineIO file in as new tracks (one undo step). Crossfades export as straight cuts for now.
