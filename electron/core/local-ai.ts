import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TranscriptSegment } from "./ai";
import { ffmpeg } from "./media";

const run = promisify(execFile);

/**
 * Locally installed AI: whisper.cpp for transcription, the macOS speech
 * synthesiser for voices, and OpenAI-compatible local servers (Ollama,
 * LM Studio) for text. Everything here works offline.
 */

export interface LocalInventory {
	whisper: { binary: string | null; models: { name: string; path: string; sizeMb: number }[] };
	macVoices: { name: string; locale: string }[];
	ollama: { installed: boolean; running: boolean; models: string[] };
	lmStudio: { running: boolean; models: string[] };
}

const home = os.homedir();

export function whisperModelDirs(appDataDir: string): string[] {
	return [
		path.join(appDataDir, "whisper"),
		path.join(home, "Library", "Application Support", "Recordly", "whisper"),
		path.join(home, ".cache", "whisper"),
		path.join(home, ".cache", "whisper.cpp"),
		"/opt/homebrew/share/whisper-cpp",
		"/usr/local/share/whisper-cpp",
		path.join(home, "whisper.cpp", "models"),
	];
}

function whisperBinaries(): string[] {
	return [
		"/opt/homebrew/bin/whisper-cli",
		"/usr/local/bin/whisper-cli",
		"/opt/homebrew/bin/whisper-cpp",
		"/usr/local/bin/whisper-cpp",
		path.join(home, "whisper.cpp", "build", "bin", "whisper-cli"),
		// Recordly ships a whisper.cpp build.
		"/Applications/Recordly.app/Contents/Resources/app.asar.unpacked/electron/native/bin/darwin-arm64/whisper-cli",
	];
}

async function json(url: string, timeoutMs = 800): Promise<unknown | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

export async function detectLocal(appDataDir: string): Promise<LocalInventory> {
	const binary = whisperBinaries().find((b) => existsSync(b)) ?? null;
	const models: LocalInventory["whisper"]["models"] = [];
	for (const dir of whisperModelDirs(appDataDir)) {
		const entries = await fs.readdir(dir).catch(() => [] as string[]);
		for (const entry of entries) {
			if (!/^ggml-.*\.bin$/.test(entry)) continue;
			const file = path.join(dir, entry);
			const stat = await fs.stat(file).catch(() => null);
			if (stat && stat.size > 10_000_000 && !models.some((m) => m.name === entry))
				models.push({ name: entry, path: file, sizeMb: Math.round(stat.size / 1e6) });
		}
	}
	const [voices, ollamaTags, lmModels] = await Promise.all([
		process.platform === "darwin"
			? run("say", ["-v", "?"]).then(({ stdout }) =>
					stdout
						.split("\n")
						.map((line) => /^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/.exec(line))
						.filter((m): m is RegExpExecArray => !!m)
						.map((m) => ({ name: m[1].trim(), locale: m[2] })),
				)
			: Promise.resolve([]),
		json("http://127.0.0.1:11434/api/tags") as Promise<{ models?: { name: string }[] } | null>,
		json("http://127.0.0.1:1234/v1/models") as Promise<{ data?: { id: string }[] } | null>,
	]).catch(() => [[] as { name: string; locale: string }[], null, null] as const);
	const ollamaInstalled =
		existsSync("/opt/homebrew/bin/ollama") ||
		existsSync("/usr/local/bin/ollama") ||
		existsSync("/Applications/Ollama.app");
	return {
		whisper: { binary, models },
		macVoices: [...voices],
		ollama: {
			installed: ollamaInstalled,
			running: !!ollamaTags,
			models: ollamaTags?.models?.map((m) => m.name) ?? [],
		},
		lmStudio: { running: !!lmModels, models: lmModels?.data?.map((m) => m.id) ?? [] },
	};
}

export function startOllama(): void {
	const binary = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"].find((b) => existsSync(b));
	if (binary) spawn(binary, ["serve"], { detached: true, stdio: "ignore" }).unref();
	else if (existsSync("/Applications/Ollama.app"))
		spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" }).unref();
	else throw new Error("Ollama is not installed.");
}

export const WHISPER_DOWNLOADS: Record<string, { url: string; sizeMb: number }> = {
	"ggml-base.en.bin": {
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
		sizeMb: 148,
	},
	"ggml-small.bin": {
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
		sizeMb: 488,
	},
	"ggml-large-v3-turbo-q5_0.bin": {
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
		sizeMb: 574,
	},
};

/** Downloads a whisper.cpp model into the app's data folder. */
export async function downloadWhisperModel(
	appDataDir: string,
	name: string,
	onProgress?: (fraction: number) => void,
): Promise<string> {
	const spec = WHISPER_DOWNLOADS[name];
	if (!spec) throw new Error(`Unknown model ${name}.`);
	const dir = path.join(appDataDir, "whisper");
	await fs.mkdir(dir, { recursive: true });
	const target = path.join(dir, name);
	const res = await fetch(spec.url);
	if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
	const total = Number(res.headers.get("content-length") ?? spec.sizeMb * 1e6);
	const handle = await fs.open(`${target}.part`, "w");
	let received = 0;
	try {
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			await handle.write(chunk);
			received += chunk.length;
			onProgress?.(received / total);
		}
	} finally {
		await handle.close();
	}
	await fs.rename(`${target}.part`, target);
	return target;
}

/** Word-level transcript with whisper.cpp (one word per segment). */
export async function transcribeLocal(
	binary: string,
	model: string,
	file: string,
	language?: string,
): Promise<{ text: string; segments: TranscriptSegment[] }> {
	const work = await fs.mkdtemp(path.join(os.tmpdir(), "cue-whisper-"));
	try {
		const wav = path.join(work, "input.wav");
		await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
		const out = path.join(work, "out");
		await run(
			binary,
			[
				"-m",
				model,
				"-f",
				wav,
				"-l",
				language ?? "auto",
				"-ml",
				"1",
				"-sow",
				"-oj",
				"-of",
				out,
				"-np",
				"-t",
				String(Math.max(2, os.cpus().length - 2)),
			],
			{
				maxBuffer: 64 * 1024 * 1024,
				timeout: 30 * 60 * 1000,
			},
		);
		const parsed = JSON.parse(await fs.readFile(`${out}.json`, "utf8")) as {
			transcription: { offsets: { from: number; to: number }; text: string }[];
		};
		const words = parsed.transcription
			.map((w) => ({ startMs: w.offsets.from, endMs: w.offsets.to, word: w.text.trim() }))
			.filter((w) => w.word);
		// Group words into sentence-sized segments.
		const segments: TranscriptSegment[] = [];
		let current: typeof words = [];
		const flush = () => {
			if (!current.length) return;
			segments.push({
				startMs: current[0].startMs,
				endMs: current[current.length - 1].endMs,
				text: current.map((w) => w.word).join(" "),
				words: current,
			});
			current = [];
		};
		for (const w of words) {
			const gap = current.length ? w.startMs - current[current.length - 1].endMs : 0;
			if (current.length && gap > 700) flush();
			current.push(w);
			if (/[.!?]$/.test(w.word)) flush();
		}
		flush();
		return { text: words.map((w) => w.word).join(" "), segments };
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

/** Speech with the macOS synthesiser, as WAV bytes. `rate` is words per minute. */
export async function speakMac(text: string, voice: string, rate?: number): Promise<Buffer> {
	const work = await fs.mkdtemp(path.join(os.tmpdir(), "cue-say-"));
	try {
		const aiff = path.join(work, "out.aiff");
		const wav = path.join(work, "out.wav");
		await run("say", ["-v", voice, ...(rate ? ["-r", String(rate)] : []), "-o", aiff, text]);
		await ffmpeg(["-i", aiff, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
		return await fs.readFile(wav);
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

/** Chat completion against any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio). */
export async function chat(input: {
	baseUrl: string;
	apiKey?: string;
	model: string;
	system: string;
	prompt: string;
}): Promise<string> {
	const res = await fetch(`${input.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
		},
		body: JSON.stringify({
			model: input.model,
			messages: [
				{ role: "system", content: input.system },
				{ role: "user", content: input.prompt },
			],
			temperature: 0.4,
		}),
		signal: AbortSignal.timeout(120000),
	});
	if (!res.ok)
		throw new Error(`Text model error ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	return body.choices?.[0]?.message?.content?.trim() ?? "";
}
