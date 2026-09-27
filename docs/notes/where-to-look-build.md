# Cue notes from building "Where to Look" (Vox-style IoT explainer, 15 min)

An agent rebuilt a 15-minute academic video (two IoT designs for wildfire inspection in the Susa Valley) in Cue over MCP: a dramatised news cold open, satellite evidence, maps from real boundaries, about 60 data-driven motion graphics, 33 narrator passages and 6 Italian news voices.
Severity as in the-red-cars-build.md: **bug**, **gap**, **ux**, **lesson**.

## Fixed during this build
1. **fixed (bug, user)** Clips generated over MCP landed on top of each other: every script line started at 0, so each new take was placed over the others on the one voiceover track (the user saw a pile of overlapping takes). Now a take that would overlap another clip goes to a free voiceover track (a new "Voiceover N" overflow track if needed), and `add_clips` from agents does the same for any clip (`avoidOverlap`; a transition into a clip may still overlap on purpose). The reply says how many clips were moved.
2. **fixed (bug)** Follow-up to 1: once lines were spaced out, the takes stayed spread over 34 tracks. `update_line` and `shift_lines` now move takes back to the voiceover track when it has room, and overflow tracks that end up empty are removed.
3. **lesson** The overlap rule also caught the agent's own mistakes: section cards 150 ms into the next scene, two graphics on one track, a drone bed on the music track. Check the add_clips summary for "put on a free track".

## Voice
4. **gap** `generate_take` has no speed. Instructions ("about 140 words per minute") barely change gpt-4o-mini-tts: takes came out at 180-186 wpm. What worked: find the pauses with silencedetect, lengthen those over 0.55 s by 320 ms (0.35 s by 180 ms), then atempo 0.95. Narration went from 11.3 to 12.9 minutes and sounds like a documentary. Offer `pace: slower | documentary` on generate_take/generate_voiceover that does this.
5. **bug (serious)** gpt-4o-mini-tts silently drops the last short sentence: "The other adapts." was missing from both takes of P14; P16 lost four sentences (52 words came back as 11); P29 lost "could". Only transcribing and comparing with the script found them (item 36 of the Red Cars notes, again). generate_take should transcribe, compare with the text and retry automatically. Folding a short final sentence into the previous one ("…no matter what, and the other one adapts to the conditions.") fixed P14.
6. **bug** Clip `speed` plays in the viewer through WebAudio playbackRate (pitch changes) but exports through atempo (pitch kept): a slowed voice sounds different while editing than in the file. Use a pitch-preserving path in the viewer too.
7. **ux** Cloud transcription (whisper-1) of takes: numbers come back as digits ("4 000", "52 5"), "22%. Both" became "22", words are doubled ("pasture pasture", "list list"), names misspelled ("montpanteiro"). The script is known: pass the line text as the transcription prompt, or align the known words to the audio, so anchors match the script.

## Media and finding assets
8. **ux** `import_found` refuses a Commons id it hasn't seen in this session's find_media results ("search with find_media first"). A `wc:File:…` id names the file exactly; resolve it directly.
9. **ux** Inconsistent argument names: `rename_media {id}` but `update_motion_graphic {assetId}`, `import_media {files}` but other tools take paths. Accept both.
10. **ux** `import_library_asset` without trackId still places sounds on the timeline; importing the library's sounds once for an agent's build script needs `place: false`.
11. **lesson (big)** Satellite evidence is free and strong. Sentinel-2 L1C scenes are in Google's public bucket (`gcp-public-data-sentinel-2`, no account): the true-colour tile of 22 October 2017 showed smoke over the Susa Valley, and a SWIR false colour (B12, B8A, B04) of the same season a year apart (Nov 2016 vs Nov 2017) showed the burn scar in magenta. Credit "contains modified Copernicus Sentinel data". Add this to the finding-assets playbook.
12. **lesson** A burn index (dNBR) between August and November counted autumn as fire: 17,600 ha against the reported 3,944. Same-season pairs only, and quote the official figure; show the image as evidence, not as a measurement.
13. **lesson** Real boundaries for maps: ISTAT regions and provinces (openpolis, CC BY 4.0) as GeoJSON, projected and simplified (Douglas-Peucker at 1 px) into path layers.

## Motion graphics
14. **bug/ux** A `rect` with a stroke and no fill is filled white. News-screen frames covered their footage. No fill should mean no fill.
15. **ux** A path's `d` is limited to 20,000 characters; a country outline needs simplifying first. Say so in the guide (or take points and simplify in Cue).
16. **ux** With `origin: "left"` a rect's x is its left edge, and a group's x/y is where its pivot goes (not an offset). Both cost a round of renders; document them in the motion guide.
17. **ux** Text `align` is left/center/right; "middle" is rejected. Fine, but the guide's anchor uses "middle" for y, which invites the mistake.
18. **ux** Clip keyframe eases are linear/ease/ease-in/ease-out/hold/bezier, while motion specs take outCubic, outBack, inOutCubic… The agent had to translate names to bezier curves. Accept the same names in both. Also: a segment's ease sits on its first keyframe; say so in set_keyframe and add_clips.
19. **gap** `add_clips` takes no color, effects or mask, and `add_adjustment_layer` no effects: 23 extra update_clip calls per build. Accept them at creation.
20. **lesson** Photo "prints" pinned to paper (a white card graphic under a small photo clip, both turned 2-5°, popping in with a paper slap) broke up long diagram scenes and made them feel like Vox collage rather than slides. A slow 1.00 → 1.035 push on every paper graphic helped too.

## Mixing
21. **bug** `auto_mix` classed every picture track that carries any sound as dialogue and raised quiet news-footage ambience by 6 dB (clips deliberately at 25%), classed SFX tracks as music and ducked them, and pulled the cold open's drone (no voice over it) down 12 dB to a music target. Detect roles from content (speech or not), respect clip volumes set on purpose, and don't treat a bed under no voice as music to duck.

## Recipes that worked
- **News pile-up cold open** (dramatised, labelled): six "screens", each a footage clip plus a chyron graphic (IN DIRETTA bug, channel logo, red ULTIM'ORA tag, white headline bar that types on, scrolling ticker, white frame) with identical keyframes; 4:3 footage filled with scale ×1.333 and crop top/bottom 0.125. The first screen starts full frame and shrinks as the second pops in; the others pop in slightly large (outBack) at turned positions, 1.6-1.8 s apart. Italian anchor voices on two alternating tracks with TV EQ (low -9, mid +5, high -5) overlap more and more; a static burst and a fast whoosh on each screen, a riser into a hit, then black and silence before the narrator's first word.
- **Word-anchored graphics**: every beat of a 30-second diagram (a reading's journey: wake, check, timestamp, save, packet, gateway, server, weather, score, ≠ index, ≠ prediction, ranked list) is computed from the take's word times, so a new take only needs a rebuild.
- **Data from the project**, not made-up charts: the simulator's traces drew the 14-day weather lines with the hidden episodes, the adaptive node's samples (one tick per packet, coloured by interval), the 30-run spread, and the route test on its real checkpoint coordinates.
