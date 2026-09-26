/**
 * When Cue may update itself, decided without Electron so it can be tested.
 * The updater (electron/updater.ts) asks this once at launch and explains a
 * "no" in its log and in Settings.
 */

export interface UpdateStatus {
	/**
	 * unsupported: this copy can't update itself (see message).
	 * idle: nothing to do (checkedAt says when it last looked).
	 * available: a version was found but needs consent before download.
	 * checking / downloading: in progress. ready: downloaded and ready to install.
	 * error: the last check or download failed (message).
	 */
	state: "unsupported" | "idle" | "checking" | "available" | "downloading" | "ready" | "error";
	/** The version being downloaded or ready to install. */
	version?: string;
	/** Download progress, 0–100. */
	percent?: number;
	/** Install this already-approved download on quit (choice captured when download began). */
	installOnQuit?: boolean;
	message?: string;
	checkedAt?: string;
}

export type MacSignature =
	| { kind: "developer-id"; authority: string }
	| { kind: "other"; authority: string }
	| { kind: "adhoc" }
	| { kind: "unsigned" };

/** Reads `codesign -dv --verbose=2 <app>` output (codesign writes it to stderr). */
export function parseCodesign(output: string): MacSignature {
	if (/code object is not signed/i.test(output)) return { kind: "unsigned" };
	const authority = /^Authority=(.+)$/m.exec(output)?.[1]?.trim();
	if (authority?.startsWith("Developer ID Application")) return { kind: "developer-id", authority };
	if (authority) return { kind: "other", authority };
	if (/Signature=adhoc/i.test(output)) return { kind: "adhoc" };
	return { kind: "unsigned" };
}

export interface SupportInput {
	platform: NodeJS.Platform;
	isPackaged: boolean;
	env: Record<string, string | undefined>;
	/** macOS only: how the running app is signed. */
	signature?: MacSignature;
}

export type Support = { ok: true } | { ok: false; reason: string };

/** Whether this copy of Cue can download and install updates, and why not. */
export function updateSupport({ platform, isPackaged, env, signature }: SupportInput): Support {
	if (!isPackaged) return { ok: false, reason: "Development build: updates are off." };
	if (env.CUE_USER_DATA)
		return {
			ok: false,
			reason: "A separate data folder (CUE_USER_DATA) is in use: updates are off.",
		};
	if (env.CUE_DISABLE_UPDATES) return { ok: false, reason: "CUE_DISABLE_UPDATES is set." };
	if (platform === "darwin") {
		if (signature?.kind === "developer-id") return { ok: true };
		const how =
			signature?.kind === "other"
				? `it is signed with "${signature.authority}"`
				: signature?.kind === "adhoc"
					? "it is only ad-hoc signed"
					: "it is not signed";
		return {
			ok: false,
			reason: `macOS only installs updates for apps signed with a Developer ID certificate, and ${how}. Download new versions from GitHub Releases.`,
		};
	}
	if (platform === "linux" && !env.APPIMAGE)
		return {
			ok: false,
			reason:
				"Only the AppImage updates itself. Update the .deb with your package manager or download it from GitHub Releases.",
		};
	if (platform !== "win32" && platform !== "linux")
		return { ok: false, reason: `Updates are not available on ${platform}.` };
	return { ok: true };
}

/** How often to look for a new version while Cue is open. */
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
