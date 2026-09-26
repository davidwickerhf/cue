# Cue

A fast, lightweight video editor for macOS, built so that you and an AI agent can edit the same project. Edit by hand with the shortcuts you already know from Premiere, Resolve and Final Cut, or let Claude Code, Codex or any MCP client cut, caption, grade and export for you. Every change is recorded, attributed to you or the agent, and can be undone or restored later.

**Website:** [cue.wicker.life](https://cue.wicker.life) · **Download:** [latest release](https://github.com/davidwickerhf/cue/releases/latest) (Apple Silicon)

## What it does

- **Timeline**: video, text and audio tracks (picture above sound), drag to reorder, mute, solo, lock, hide. Selection, blade, slip, roll and slide tools; ripple delete, lift and extract, ripple trim (Q/W), snapping, markers, J/K/L, in/out points, clip labels, enable/disable.
- **Source monitor**: mark in and out on a clip, then insert (,) or overwrite (.) at the playhead.
- **Sequences**: several timelines per project, and Nest to turn clips into one nested sequence.
- **Motion and look**: keyframes for position, scale and volume; push-in zooms; crossfades and dips; speed and speed ramps; colour (brightness, contrast, saturation, temperature, LUTs); adjustment layers; masks; chroma key; frame holds.
- **Titles**: eleven templates, every installed font, outline, gradient, spacing, rotation, animations, and typing directly on the viewer.
- **Audio**: waveforms, mixer with per-track level, pan, meters, solo; music that ducks under the voiceover; denoise; loudness normalisation; beat detection and cut-to-the-beat.
- **Speech**: word-level transcripts, text-based editing (delete words to cut them), filler-word removal, search by meaning, chapters, captions.
- **Voiceover booth**: a script on the timeline as timed lines, teleprompter recording with takes per line, or AI voices.
- **Generate**: voices, captions, images and B-roll with OpenAI, or on-device with macOS voices, Whisper and Ollama / LM Studio.
- **Agents**: an in-app chat that runs Claude Code, Codex or Gemini CLI with Cue's tools only, and 110+ MCP tools for any client, with a written guide sent to every agent.
- **Projects**: `.cueproj` files, a projects overview, relinking of moved media, a complete persistent history, workspaces.
- **Export**: H.264, HEVC or ProRes (hardware encoding), presets, in-to-out ranges, stills, stems, captions, and timelines for other editors (OpenTimelineIO, FCPXML, MLT, EDL).

## Install

Download `Cue-mac-arm64.zip` from the [latest release](https://github.com/davidwickerhf/cue/releases/latest), unzip, and move Cue to Applications. The app is signed but not notarised yet, so the first time, right-click Cue and choose Open.

Agents connect with one command (shown in Cue under Agent → Connect):

```sh
claude mcp add --scope user cue -- node "/Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs"
```

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
| OpenTimelineIO `.otio` | DaVinci Resolve, Premiere (plug-in), Kdenlive, Avid | Tracks, cuts, speed, titles as generators, markers, nested sequences as nested stacks, adjustment layers as generators, plus Cue's clip settings in metadata |
| FCPXML 1.10 `.fcpxml` | Final Cut Pro, DaVinci Resolve | Tracks as lanes, cuts, speed, volume, Basic Title text, markers, nested sequences as compound clips (Final Cut has no adjustment layers) |
| MLT XML `.mlt` | Shotcut | Tracks, cuts, speed, volume, text as dynamic text, mute and hide, nested sequences as nested tractors, adjustment layers as timeline colour filters |
| CMX3600 `.edl` | Almost anything | The main video track and two audio tracks; nested sequences as their rendered file |

File → Import Timeline brings an OpenTimelineIO file in as new tracks (one undo step), rebuilding nested stacks as nested sequences and Cue's adjustment layers. Crossfades export as straight cuts for now.

## License

MIT. See [LICENSE](LICENSE).
