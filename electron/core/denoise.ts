import { existsSync } from "node:fs";
import path from "node:path";
import type { DenoiseMode } from "./types";

/**
 * Noise reduction, the same in the export and the preview's audio proxies.
 * "light" is ffmpeg's FFT denoiser; "voice" is RNNoise (arnndn) with the
 * model Xiph shipped with RNNoise (BSD-3, see resources/rnnoise/LICENSE).
 */

/** How much of the denoised signal to keep; a trace of the original keeps speech natural. */
export const VOICE_DENOISE_MIX = 0.9;

/** Where the RNNoise model is: an override, inside the app, or in the repo. */
export function rnnoiseModel(): string | null {
	const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	const candidates = [
		process.env.CUE_RNNOISE_MODEL,
		resources && path.join(resources, "rnnoise", "std.rnnn"),
		typeof __dirname === "string" && path.join(__dirname, "..", "resources", "rnnoise", "std.rnnn"),
		path.join(process.cwd(), "resources", "rnnoise", "std.rnnn"),
	].filter((p): p is string => !!p);
	return candidates.find((p) => existsSync(p)) ?? null;
}

/** Quoted for an ffmpeg filter option (the same escaping as LUT paths). */
const quote = (file: string) => `'${file.replace(/\\/g, "/").replace(/'/g, "\\'")}'`;

/** ffmpeg filters for a clip's noise reduction (empty when off). */
export function denoiseFilters(mode: DenoiseMode | boolean | undefined): string[] {
	if (mode === "voice") {
		const model = rnnoiseModel();
		// Without the model (a broken install) fall back to the FFT filter rather than fail the export.
		if (model) return ["highpass=f=80", `arnndn=m=${quote(model)}:mix=${VOICE_DENOISE_MIX}`];
	}
	if (mode === "light" || mode === true || mode === "voice")
		return ["highpass=f=80", "afftdn=nf=-25:tn=1"];
	return [];
}

/** The filters as a chain suffix (",a,b" or ""). */
export function denoiseChain(mode: DenoiseMode | boolean | undefined): string {
	return denoiseFilters(mode)
		.map((f) => `,${f}`)
		.join("");
}
