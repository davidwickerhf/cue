import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { contract, type MethodName, parseInput } from "../control/contract";
import { mixRole } from "./audio";
import { clipEnd } from "./project";
import type { MediaClip, ProjectData } from "./types";

/**
 * Recipes: reusable edits as a list of tool calls. Parameters may hold
 * placeholders ("{playheadMs}", "{musicAssetId}"…) filled in from the open
 * project when the recipe runs, so one recipe works on any edit. People run
 * them from the Generate panel; agents list, run and save them as tools.
 */

/** Tools a recipe may not call: recipes don't nest, and only the user reviews. */
const FORBIDDEN = new Set<string>([
	"run_recipe",
	"save_recipe",
	"delete_recipe",
	"review_changes",
	"record_line",
	"close_project",
	"open_project",
	"create_project",
]);

export const recipeStepSchema = z.object({
	tool: z
		.string()
		.refine((t) => t in contract && !FORBIDDEN.has(t), { message: "Not a tool a recipe can use" }),
	params: z.record(z.string(), z.unknown()).default({}),
	label: z.string().max(200).optional(),
	/** Run the step once per id in this list placeholder, with "{clipId}" set to each. */
	each: z.string().optional(),
	/** A failing optional step is reported and skipped instead of stopping the recipe. */
	optional: z.boolean().optional(),
});

export const recipeSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	description: z.string().max(1000).default(""),
	steps: z.array(recipeStepSchema).min(1).max(50),
});

export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Recipe = z.infer<typeof recipeSchema> & { builtIn?: boolean };

/** What a recipe can refer to. Values are null when the project has nothing that fits. */
export interface RecipeContext {
	playheadMs: number;
	selectedClipIds: string[];
	selectedClipId: string | null;
	durationMs: number;
	projectName: string;
	/** The main speech: a transcribed item on the timeline, else the voiceover or first video with sound. */
	voiceoverAssetId: string | null;
	musicAssetId: string | null;
	firstVideoClipId: string | null;
	firstMusicClipId: string | null;
	/** Clips on dialogue and voiceover tracks. */
	voiceClipIds: string[];
	/** "voiceover" when there is a voiceover track with clips, else "mix". */
	captionSource: "voiceover" | "mix";
}

export const PLACEHOLDERS: Record<keyof RecipeContext, string> = {
	playheadMs: "where the playhead is",
	selectedClipIds: "the selected clips",
	selectedClipId: "the first selected clip",
	durationMs: "length of the edit",
	projectName: "the project's name",
	voiceoverAssetId: "the main speech media (transcribed, voiceover or first video with sound)",
	musicAssetId: "the music on the timeline",
	firstVideoClipId: "the first clip on the picture",
	firstMusicClipId: "the first music clip",
	voiceClipIds: "every clip on dialogue and voiceover tracks",
	captionSource: "voiceover if there is one, else the mix",
};

export function recipeContext(
	data: ProjectData,
	view: { playheadMs: number; selectedClipIds: string[] },
): RecipeContext {
	const used = data.clips
		.filter((c): c is MediaClip => c.type === "media" && !c.disabled)
		.sort((a, b) => a.startMs - b.startMs);
	const asset = (id: string) => data.assets.find((a) => a.id === id);
	const trackOf = (c: MediaClip) => data.tracks.find((t) => t.id === c.trackId);
	const voiceTrack = data.tracks.find((t) => t.kind === "audio" && t.voiceover);
	const music = used.filter((c) => {
		const t = trackOf(c);
		return t?.kind === "audio" && !t.voiceover && mixRole(data, t) === "music";
	});
	const dialogue = used.filter((c) => {
		const t = trackOf(c);
		return (
			!!t && t.kind !== "text" && mixRole(data, t) === "dialogue" && !!asset(c.assetId)?.hasAudio
		);
	});
	const speech =
		used.find((c) => !!asset(c.assetId)?.transcript?.words.length) ??
		used.find((c) => c.trackId === voiceTrack?.id) ??
		used.find((c) => asset(c.assetId)?.kind === "video" && asset(c.assetId)?.hasAudio);
	const picture = used.find((c) => {
		const kind = asset(c.assetId)?.kind;
		return trackOf(c)?.kind === "video" && (kind === "video" || kind === "image");
	});
	return {
		playheadMs: Math.round(view.playheadMs),
		selectedClipIds: view.selectedClipIds,
		selectedClipId: view.selectedClipIds[0] ?? null,
		durationMs: data.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0),
		projectName: data.name,
		voiceoverAssetId: speech?.assetId ?? null,
		musicAssetId: music[0]?.assetId ?? null,
		firstVideoClipId: picture?.id ?? null,
		firstMusicClipId: music[0]?.id ?? null,
		voiceClipIds: dialogue.map((c) => c.id),
		captionSource: used.some((c) => c.trackId === voiceTrack?.id) ? "voiceover" : "mix",
	};
}

const WHOLE = /^\{(\w+)\}$/;
const INSIDE = /\{(\w+)\}/g;

/**
 * Fills placeholders in a step's parameters. A value that is exactly one
 * placeholder takes the value as is (a number, a list); placeholders inside
 * longer text are written in. Unknown names are left alone.
 */
export function resolveParams(
	params: unknown,
	ctx: Record<string, unknown>,
	missing: Set<string> = new Set(),
): unknown {
	if (typeof params === "string") {
		const whole = params.match(WHOLE);
		if (whole && whole[1] in ctx) {
			const value = ctx[whole[1]];
			if (value === null || (Array.isArray(value) && value.length === 0)) missing.add(whole[1]);
			return value;
		}
		return params.replace(INSIDE, (all, name: string) => {
			if (!(name in ctx)) return all;
			const value = ctx[name];
			if (value === null) missing.add(name);
			return String(value ?? "");
		});
	}
	if (Array.isArray(params)) return params.map((p) => resolveParams(p, ctx, missing));
	if (params && typeof params === "object")
		return Object.fromEntries(
			Object.entries(params).map(([k, v]) => [k, resolveParams(v, ctx, missing)]),
		);
	return params;
}

export interface ResolvedStep {
	index: number;
	tool: MethodName;
	label: string;
	params: Record<string, unknown>;
	optional: boolean;
	/** Why it can't run (missing material or bad parameters), if so. */
	problem?: string;
}

/** The calls a recipe makes on this project, in order, each checked against the contract. */
export function resolveRecipe(recipe: Recipe, ctx: RecipeContext): ResolvedStep[] {
	const values = ctx as unknown as Record<string, unknown>;
	const out: ResolvedStep[] = [];
	recipe.steps.forEach((step, index) => {
		const tool = step.tool as MethodName;
		const label = step.label ?? tool.replaceAll("_", " ");
		const optional = !!step.optional;
		const one = (extra: Record<string, unknown>) => {
			const missing = new Set<string>();
			const params = resolveParams(step.params, { ...values, ...extra }, missing) as Record<
				string,
				unknown
			>;
			let problem: string | undefined;
			if (missing.size)
				problem = `Needs ${[...missing].map((m) => PLACEHOLDERS[m as keyof RecipeContext] ?? m).join(" and ")}, which this project doesn't have.`;
			else
				try {
					parseInput(tool, params);
				} catch (error) {
					problem = zodMessage(error);
				}
			out.push({ index, tool, label, params, optional, ...(problem ? { problem } : {}) });
		};
		if (step.each) {
			const list = resolveParams(step.each, values);
			if (!Array.isArray(list) || list.length === 0) {
				out.push({
					index,
					tool,
					label,
					params: step.params,
					optional,
					problem: `Nothing to do: ${PLACEHOLDERS[step.each.replace(/[{}]/g, "") as keyof RecipeContext] ?? step.each} is empty.`,
				});
				return;
			}
			for (const clipId of list) one({ clipId });
		} else one({});
	});
	return out;
}

function zodMessage(error: unknown): string {
	if (error instanceof z.ZodError)
		return error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
	return (error as Error).message;
}

// ---------------------------------------------------------------------------
// Built-in recipes
// ---------------------------------------------------------------------------

export const BUILT_IN_RECIPES: Recipe[] = [
	{
		id: "social-clip",
		name: "Social clip",
		description:
			"Word-by-word captions, then a vertical 9:16 version exported for Reels, Shorts and TikTok.",
		builtIn: true,
		steps: [
			{
				tool: "auto_captions",
				params: { source: "{captionSource}", style: "highlight" },
				label: "Animated captions",
			},
			{ tool: "make_variants", params: { aspects: ["9:16"] }, label: "Export a 9:16 version" },
		],
	},
	{
		id: "podcast-polish",
		name: "Podcast polish",
		description:
			"Levels dialogue and music, removes background noise from every voice clip and adds plain captions.",
		builtIn: true,
		steps: [
			{ tool: "auto_mix", params: {}, label: "Level the mix" },
			{
				tool: "update_clip",
				params: { id: "{clipId}", patch: { denoise: "voice" } },
				each: "{voiceClipIds}",
				label: "Remove noise",
			},
			{
				tool: "auto_captions",
				params: { source: "{captionSource}", style: "plain" },
				label: "Captions",
				optional: true,
			},
		],
	},
	{
		id: "punchy-intro",
		name: "Punchy intro",
		description:
			"A headline with the project's name at the start, a push-in on the first shot and the music fading in.",
		builtIn: true,
		steps: [
			{
				tool: "add_text",
				params: { text: "{projectName}", startMs: 0, durationMs: 2500, preset: "headline" },
				label: "Title at the start",
			},
			{
				tool: "add_zoom",
				params: { clipId: "{firstVideoClipId}", startMs: 0, endMs: 2500, scale: 1.3, easeMs: 600 },
				label: "Push in on the first shot",
				optional: true,
			},
			{
				tool: "update_clip",
				params: { id: "{firstMusicClipId}", patch: { fadeInMs: 1500 } },
				label: "Fade the music in",
				optional: true,
			},
		],
	},
	{
		id: "clean-up",
		name: "Clean up",
		description:
			"Cuts long pauses from the speech, then um and uh (when the speech has been transcribed).",
		builtIn: true,
		steps: [
			{ tool: "remove_silence", params: { minSilenceMs: 700, keepMs: 150 }, label: "Cut pauses" },
			{
				tool: "remove_filler_words",
				params: { assetId: "{voiceoverAssetId}" },
				label: "Cut filler words",
				optional: true,
			},
		],
	},
];

// ---------------------------------------------------------------------------
// User recipes, stored in app data
// ---------------------------------------------------------------------------

const fileSchema = z.object({ recipes: z.array(recipeSchema).default([]) });

export async function loadRecipes(file: string | undefined): Promise<Recipe[]> {
	if (!file) return [];
	try {
		return fileSchema.parse(JSON.parse(await fs.readFile(file, "utf8"))).recipes;
	} catch {
		return [];
	}
}

export async function saveRecipes(file: string, recipes: Recipe[]): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const clean = recipes.map(({ builtIn: _, ...r }) => r);
	await fs.writeFile(file, JSON.stringify({ recipes: clean }, null, 2));
}

/** An id from the name, unique among `taken`. */
export function recipeId(name: string, taken: string[]): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "recipe";
	let id = slug;
	for (let n = 2; taken.includes(id); n++) id = `${slug}-${n}`;
	return id;
}
