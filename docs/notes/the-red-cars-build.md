# Cue notes from building "The Red Cars" (Hoog-style remake)

Bugs, rough edges and lessons found while an agent built a 3.5-minute documentary in Cue over MCP.
Severity: **bug** (wrong behaviour), **gap** (missing capability), **ux** (works, but costs the agent time), **lesson** (craft, for playbooks).

## Script and voice
1. **bug** `set_lines` with new `startMs` values does not move the lines' voiceover clips; `update_line` does. After re-timing 26 lines every take still sat at 0 and had to be moved one by one with `update_clip`. `set_lines` should move linked takes like `update_line`, or say it doesn't.
2. **bug** `generate_voiceover` returned a 300 ms take for a 22-word line (N04) and reported it without warning. Detect implausibly short speech (for example under 40% of words × 350 ms), retry once, and flag it.
3. **ux** Generating several voices means one `generate_voiceover` call per voice; a per-line `voice`/`instructions` in the script (or in the call) would let one call voice a narrator, a records reader and an announcer.
4. **gap** No per-clip or per-track "radio / telephone / old recording" treatment beyond a 3-band EQ. A band-pass preset (300 Hz–3.4 kHz) plus light saturation would make archival-sounding voices easy.

## Media
5. **bug** `import_media` fails the whole batch ("Cannot read media") on one Pixel "HDR+" JPEG with an embedded gain map. It should import the rest and report the one it skipped; better, decode Ultra HDR JPEGs (they are valid JPEGs).
6. **ux** `list_media` doesn't return file paths, so finding a generated image on disk means searching the project folder.
7. **ux** `generate_image` names the media item with the whole prompt; a short title (or a `name` parameter) would keep the media panel readable.

## Reference analysis
8. **ux** `analyze_reference` on a 19-minute video took over 10 minutes and the reply is very long. The cache went into the open project's `.cue-cache/reference` (frames of someone else's video inside this project's folder). Cache outside the project, and offer a short summary reply.

## Viewer and rendering
9. **bug** `render_frame` returned a screenshot of an open Settings dialog instead of the viewer. It should render the composition offscreen (or hide overlays) so a dialog left open never ends up in a check.

## Transcripts
10. **ux** `get_transcript` with `search` returns only word indices (`from`, `to`), not times; the agent needs a second call for the words. Include `startMs`/`endMs` of the match.

## Motion graphics
11. **ux** In `create_motion_graphic`'s reply, a text layer with a `type` enter shows `text: ""` in `motion.texts` (its first frame), so it looks empty. List the layer's full text.

## Lessons (for the playbooks)
- A 2:1 canvas (1920×960) is part of this look; archive 4:3 needs scale 1.5 to fill, and 1.55 so pushes never show an edge.
- Hoog's grammar: warm, saturated, orange film archive; glowing line maps on black; tabletop "evidence" scenes lit by one lamp; black-and-white newsreel; modern aerials for contrast. Measured: median shot 3.3 s, 10.9 cuts a minute, half the picture black, 56% monochrome, -16.2 LUFS.
- Dramatised voices (announcers) must be labelled on screen as dramatisations when they are not archival.

## Found while assembling the edit
12. **bug** Adding a library texture (film-dust) with `add_clips` ignores its recommended `use` (screen blend, opacity, loop): the clip is opaque black and stops after 6 s, so over the 2:1 frame it covered the picture with a black 16:9 box. `import_library_asset {trackId, startMs, durationMs}` does it right (back-to-back loops, screen, 0.6). Either `add_clips` should apply the asset's `use`, or the guide should say "always add library textures with import_library_asset".
13. **ux** A looping texture comes in as many 6 s clips; one looping clip (a `loop` flag on media clips) would be easier to move, trim and scale.
14. **ux** Text clip `style.x` is the centre of the rendered text, not of the `width` box, so a label can't be pinned to a left margin without knowing its width. The agent estimated widths from character counts (monospaced font). Add an anchor (`anchorX: left | center | right`) or return each text clip's measured box.
15. **bug** In a motion-graphic spec, an `image` layer with a local file path (`src: "/…/paper-off-white.jpg"`) did not render; the page was invisible. Embed the file when the graphic is made, or reject paths it can't read.
16. **bug?** A `group` with `x`/`y` keys and `pivot` put its contents far off-canvas (the document page slid below the frame). Layers inside a group seem to be positioned in canvas space and the group's x/y then offsets them again. Clarify in the guide, or make group x/y the pivot position.
17. **bug** `update_clip` with `transform` and `keyframes` in one patch applied only the transform (the reply said "(transform)"); the scale keyframes were dropped.
18. **ux** `render_frame` sometimes returns a frame before media has loaded (a graphic stuck at an early frame, a photo black); rendering again a moment later was right. It should wait until every visible clip is decoded.
19. **ux** Moving a portrait photo into a 2:1 frame: `scale 1` is "fit", so filling needs 2 / aspect (2.75 for a 3:4 portrait). A `fit: "cover" | "contain"` option on media clips would save the arithmetic.

## Lessons (more)
- Look at frames of every scene after the first pass; three of the problems above were invisible in the tool replies.
- For dark "evidence" tabletop scenes, a multiply lamp falloff kills legibility; keep the page lit (a light pool from #fff to a warm mid tone) and let only the desk go dark.
- auto_mix treats every voice track as dialogue at -16 LUFS; with a filtered records voice that's right, and music landed 8 dB under with ducking.

## Performance and export (the user saw the app become slow and buggy on this project)
20. **bug (critical)** Export failed outright: "Failed to configure output pad on auto_scale_167 / Error reinitializing filters" on a 2:1 project with 21 screen-blended dust loops over pictures. Hiding either the dust track or the picture track fixed it. Each blended clip adds a full-length `color` source and converts the *whole edit* to gbrap and back (`[current]format=gbrap … blend … format=yuva420p`), so 21 blend clips chain 21 full-frame RGB blends through every frame of the film, even where the clip isn't on screen (`enable` only switches the result). Fix: blend only inside the clip's time (trim the base to the clip's range, blend, concat), or blend each clip on its own canvas-sized, clip-length stream; merge adjacent clips of the same asset.
21. **bug** A range export (2–3 s) still builds the filter graph for every clip on the timeline (the same "stream #206" failed for any range). Clips outside the range should be left out: faster and more robust.
22. **bug** A failed export leaves a 0-byte file, and the next export with that name is refused ("already exists"). Delete the partial file on failure.
23. **ux** Export errors kept only the last 2,000 characters of ffmpeg's log and not the command. Fixed during this build: failed ffmpeg runs now write the command and full log to `$TMPDIR/cue-ffmpeg-last-failure.txt` (the reply is still shortened on the way through the MCP bridge; say where the file is).
24. **perf** The user reports the app becomes very slow and buggy on this project even without an export running, and worse during export. The project has about 150 clips: 56 pictures (photos up to 6000 px, 640×480 films upscaled 1.55×), 14 motion graphics, 21 dust video loops, 17 text clips, 38 effects and 5 music clips. To profile: renderer frame time in the viewer, decoding of full-size photos (are image proxies used everywhere?), Lottie rendering of every graphic in the visible range, timeline re-render cost per state change, waveform/peaks work, and whether export (ffmpeg with 200+ inputs) starves the UI (run it with a lower priority and a thread limit).
25. **ux** Two dev instances can end up running against the same user data; the bridge follows `control.json` (the newest), but the older window stays open and confusing.

## Release pipeline
26. **bug** v0.2.2's three build jobs raced to create the draft release and made two drafts for one tag; only the Mac one was published, so the Windows installer, Linux files and `latest.yml`/`latest-linux.yml` were missing (Windows and Linux updates would have failed). Fixed by hand (assets moved, hashes checked, duplicate draft deleted) and in the workflow (a `draft` job creates the release before the builds).
27. **slow** The Mac job takes about 70 minutes: two architectures signed file by file with timestamps, then notarised one after the other (Apple's queue took 30+ minutes for the first submissions of a new Developer ID team).

## Performance: measured and fixed during this build
28. **fixed (perf, big)** The media panel and the timeline drew image media with the *original file* (`project.assetUrls`), so every thumbnail tile decoded the full-size photo: 29 photos up to 6000 px, several tiles each, **2,002 MB of decoded pixels** in the window. Now images get a cached 320 px thumbnail (`makeImageThumb`, `store.thumbnails` for images) used by the media panel (`useThumb`) and the timeline (`ImageTiles`). Decoded image memory: 2,002 MB → 36 MB.
29. **fixed (perf, big)** `warmAudio` decoded the sound of every clip near the playhead, audible or not. Archive films used only for their picture (volume 0) are long: the 1954 GM film is 22 minutes, about 500 MB decoded, and three such films sat in memory. It now skips clips that aren't audible (`audible()`: volume 0, muted/hidden track, solo). Renderer memory with the project open: **2,128 MB → 740 MB**, and flat while playing through archive sections.
30. **perf (to do)** An audible clip still decodes its *whole* source (`audioProxy` → `decodeAudioData` of the full file): a 4 s clip from a 22-minute film holds 22 minutes of audio. Extract and decode only the clip's range (plus handles), keyed by range.
31. **perf (to do)** Export took 587 s for 224 s of 1920×960 (2.6× real time); one ffmpeg graph with 200+ inputs. Render in segments (per scene or per N seconds) in parallel and concat, skip clips outside the range, and run ffmpeg at lower priority so the UI stays responsive.
32. **bug** `open_project` from an agent loads the project but the window stays on the projects overview; the user watching sees nothing. It should switch the window to the editor (or say it didn't).
33. **bug** `update_clip` silently ignores `keyframes` in a patch (the reply says "Edited clip … ()"); keyframes need `set_keyframe`/`edit_keyframes`. Reject unknown or unsupported fields with an error instead of ignoring them.

## Second pass
34. **bug** Export renders text and motion graphics in the editor window. With that window closed (or its renderer gone), an export fails after a minute with "The editor window did not respond", and the first attempt left a 48-byte file. Render for export in a hidden window of its own, recreate it if needed, and never depend on the window the user is looking at.
35. **fixed** The ffmpeg failure report in the temp folder was overwritten by the test suite (a test fails ffmpeg on purpose); it isn't written under vitest any more.
36. **bug** A generated voice take silently dropped its last sentence ("Then the rails were paved over."); only transcribing the take showed it. generate_take / generate_voiceover should transcribe and compare with the text (the words are right there) and warn or retry.
37. **lesson** Voicing whole passages (10 takes instead of 21) made the narrator consistent; anchoring every cut to words in a per-line word index made re-timing after a new take a one-command job.
38. **fixed (bug)** Export timed out ("The editor window did not respond") on an edit with 21 animated labels. All text clips went to the window in one request budgeted as one frame each (60 s + 250 ms per clip), but animated text (typewriter, fades, word styles) is rendered frame by frame. Animated text clips now get a request each, timed by their frame count; static text still goes in one batch.
39. **fixed (bug, serious)** The MCP bridge found the app through `CUE_DATA_DIR`, but the app takes its data folder from `CUE_USER_DATA`. Driving a second copy (a dev build) with only `CUE_USER_DATA` set made the bridge silently talk to the *installed* app instead: the whole Red Cars build ran in the user's Cue 0.2.1 (which is why the user saw it slow down, why exports failed with 0.2.1's bugs after they were fixed in source, and why open_project never showed up in the dev window). The bridge now accepts either variable. Better still: the bridge should say which app (path, version, pid) it is talking to in get_state, and warn when two copies are running.
40. **ux** When two copies of Cue have the same project open, both write the same file. Cue should lock a project (a lock file with the pid) and open it read-only, with a warning, in a second copy.
41. **fixed (bug)** The hardware H.264 encoder (VideoToolbox) sometimes refuses to start ("Error initializing output stream") and the export failed. It now retries with the software encoder. A failed export also deletes its partial file (item 22).
42. **fixed (bug, root cause)** Heavy exports failed with "Error initializing output stream" on *any* encoder (VideoToolbox and x264): the one ffmpeg process had 186 inputs, each with its own pool of decoder threads (about one per core), and ran out of threads (macOS allows 4,096 per process) before the encoder could start. Proven by running the logged command by hand: it fails as is and succeeds with `-threads 1` per input. The exporter now gives each input one decoder thread when there are more than 24 inputs. This was also behind the earlier failure with 21 dust clips (item 20), which added 21 more inputs. `CUE_KEEP_GRAPH=1` keeps the filter graph so a failed command can be re-run.
43. **perf** With one decoder thread per input the full export took 661 s for 217 s of video (3× real time), up from 587 s. The real fix is to stop building one graph with 186 inputs: render per scene or per segment, in parallel, and concatenate.
44. **lesson** v2 audit: the case document (16 s) and the scrapyard (10 s) hold too long without a cutaway; a "1961" year stamp collided with the map's own title and repeated its counter; a crop fixed by hand in v1 was lost when the builder rebuilt the edit.

## From the user, while this was built (fixed in 0.2.3)
45. **gap** The in-app agent told the user it couldn't add music because the library has none. Added find_music (Openverse: CC0, public domain, CC BY, CC BY-SA, with credit lines), import_music and generate_music (original beds composed with ffmpeg in six moods, exactly as long as the edit, -20 LUFS for ducking); the guide now says never to leave a video without a bed.
46. **ux** Agent replies showed raw markdown (`**bold**`, `- ` lists) in the Agent panel. They are rendered now (safe: React elements, no HTML).
47. **ux** Earlier voiceover takes were kept but listed below the whole script, off screen; the selected line now lists its takes under it and every line shows how many it has.
48. **ux** Recording stopped by itself at the line's maximum, and the countdown was a small label. Now: a big 3-2-1, a live timer (amber past the target, red past the maximum), recording until the user stops it, then a review: use, keep the previous take, discard, or fit the edit (ripple_from makes room or closes the gap), with a suggestion based on the length.
49. **bug (user's project)** "I recorded a new take but still hear the original": the draft screen recording on V1 had its own narration at full volume under the voiceover. The review now warns about other sound under the line and offers to mute it.
50. **fixed (bug, user)** Recorded takes were about 20 dB too quiet (-40.8 LUFS, peak -25 dB, against -4.5 dB for an imported take): the mic is opened raw (autoGainControl off) and a MacBook's built-in mic is quiet that way; a clip's volume (up to +6 dB) can't make up for it. New takes are levelled when saved (levelSpeech: up to +30 dB towards -18 LUFS, limited, the original kept as .original.wav); existing ones get a "Raise to voice level" button in the takes list (and level_take for agents).
51. **gap (user)** The in-app agent found clicks and results by stepping through frames with render_frame: slow, and blind to clicks that barely change the screen. Added detect_activity: frames shrunk to 192×108 grey at 10 fps, compared frame to frame, sorted into screen-change, ui-change (with region), scroll (with distance), typing, pointer and idle, tidied (eased scrolls and redraws merged), mapped to timeline time, with what editors do at each and optional markers. The user's 2:48 demo took 4.8 s. A 'screen-recording-demo' playbook covers the editing: pace, zooms to regions, sound on actions, a bed, the recording's own sound.
