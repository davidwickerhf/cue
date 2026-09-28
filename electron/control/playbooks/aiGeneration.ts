import type { Playbook } from "./index";

export const AI_GENERATION: Playbook = {
	id: "ai-generation",
	name: "Generating voice, sound, music and video",
	category: "workflow",
	summary:
		"When to generate (and when to find or use real material), what each connected service is best at, how to prompt it, keeping a project consistent, and spending the user's credits well.",
	useWhen:
		"Before generating a voiceover, sound effects, music or video clips, or when the edit lacks material and you're deciding whether to generate it.",
	body: `# Generating voice, sound, music and video

Cue can make material with services the user connected (Settings → AI). What is possible right now is in get_state (ai.canMake) and get_ai_status: each capability says the provider it will use, or which service to connect. fal alone covers voice, sound effects, music, video clips and images; OpenAI covers its own voices, images, transcription and text; ElevenLabs directly adds the user's own and cloned voices and music. Nothing connected for a capability: say which service would unlock it ("Connect fal in Settings → AI") and carry on with what you have (the library, find_media, find_sfx, generate_sfx, generate_music {mood}).

## First: should this be generated at all?

Use real material first when it exists: the project's own footage (search_shots, find_moments), then the library and openly licensed media (list_library_assets, find_media, find_music, find_sfx). Generate when nothing real fits, when the thing can't be filmed (an idea, a process, a what-if, an abstract background), or when a specific sound or bed has to match the moment exactly.

Honesty rules, by kind of video:
- News, documentary, true crime, history, anything about real people or events: never generate footage, voices or sounds that could pass for a record of what happened (no "archive" clips, no real people, no invented places presented as real). Illustrations, maps, abstract or clearly stylised visuals and music are fine. Generated shots are marked AI in the media; if one is used, say so in the description or credits.
- Explainers and essays: generated clips are good for concepts, metaphors, transitions and establishing moods; keep them stylised enough that nobody mistakes them for evidence.
- Product and brand films: generated b-roll and atmospheres are fine; the product itself comes from real footage or the user's own pictures (animate a real product still with generate_clip {imageAssetId}), never an invented product.
- A cloned or real person's voice: only a voice the user owns (their account's cloned voices), never an imitation of someone else.

## Voice

- Pick one voice for the whole project and keep it (update_ai sets the project default; takes then match). list_voices shows ElevenLabs voices with labels (accent, age, gender, use): choose for the video's audience and tone, and listen to its preview. With a direct ElevenLabs key the user's own and cloned voices are there; through fal, ElevenLabs' default voices by name.
- OpenAI voices take delivery instructions (voiceInstructions, or instructions per take): "warm, curious, measured pace, smiles on the jokes".
- ElevenLabs eleven_v3 ignores instructions: steer it with audio tags inside the spoken text, sparingly and where the script means it: [whispers], [excited], [sighs], [laughs], [pause]. Pass the tagged text as generate_take {text}: the script line stays clean, so captions and transcripts don't show the tags. eleven_multilingual_v2 is steadier for long narration; the Flash model is fast for drafts.
- Voice every line with the same settings, transcribe the take and read it against the script (dropped or doubled words happen), level_take quiet takes, auto_mix.

## Sound effects

- generate_sound (ElevenLabs) for specific, realistic sounds. Describe what makes the sound, the material, the action, the space and the length: "heavy wooden door slams shut in a stone hallway, short echo, 1.5 s", "soft paper page turned quickly, close, dry room". Not "door sound".
- One sound per event, varied: make variants for repeated events (clicks, pops, whooshes) and use a different one each time; a loop for ambiences (room tone, rain, city) with loop: true.
- generate_sfx (no service needed) for quick designed whooshes, risers, hits and UI blips; find_sfx for real recordings with credits.
- Keep them under the voice (auto_mix), and not on every cut: sound marks what matters.

## Music

- generate_music {prompt, instrumental: true} (ElevenLabs) when the edit needs a bed that fits exactly: say the genre, mood, instruments, tempo (BPM) and how it moves ("warm lo-fi hip hop, 84 BPM, soft Rhodes and vinyl crackle, steady, no drop"; "tense documentary underscore, low strings and pulses, builds slowly to a swell at the end"). Ask for the edit's length (lengthMs) so it ends where the video ends; for a video cut to the beat, generate first, detect_beats, then cut.
- generate_music {mood} (no service) makes a simple original bed; find_music for real tracks with credits.
- One bed per section at most; duck it under the voice (auto_mix).

## Video clips

- generate_clip makes 5–10 s silent shots (Kling 2.5 Turbo by default, Hailuo 2.3). Write the prompt like a shot list: subject, action, camera move, lens, light, style, mood. "Slow dolly in on a lone lighthouse at dusk, waves breaking below, warm backlight, light mist, cinematic, 35 mm"; "top-down macro of ink spreading through water, deep blue, slow motion".
- For a consistent look, make one still in the project's style with generate_image and animate it (imageAssetId), or animate a real frame of the edit (frameAtMs) so the new shot matches what's around it. Reuse the same style words in every prompt of a project (palette, lens, grain, era).
- They take one to a few minutes: start them early (several in a row), keep editing, collect them with wait_for. Trim to the part that works; slow them a little (speed 0.8–0.9) if the motion is hurried; grade them like the rest (copy_grade). They are silent: give each one a sound of its own (generate_sound for the ambience or the action in the shot, looped for a long hold).
- Not for text, logos, faces that must be right, or anything factual; use motion graphics and real footage for those.

## Images

generate_image for title cards, stills, illustrations and start pictures for clips; keep one style across a project (say it in every prompt).

## Spending the user's credits

Everything generated costs the user money; clips cost the most, then music, then voices and sounds. Make what the edit needs, not a pile to choose from: 2–3 variants of a sound, one music bed (a second only if the first doesn't fit), one or two clips per missing shot. Before a big batch (a full voiceover of a long script, more than a handful of clips or long music), say what you'll generate and roughly how much, and go ahead unless it's clearly more than they asked for. Reuse what's already in the media before generating again.
`,
};
