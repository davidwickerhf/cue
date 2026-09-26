import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { AppUpdater } from "electron-updater";
import {
	type MacSignature,
	parseCodesign,
	type Support,
	UPDATE_INTERVAL_MS,
	type UpdateStatus,
	updateSupport,
} from "./core/updates";

const run = promisify(execFile);

/**
 * Updates from GitHub Releases (electron-updater). Checks at launch and every
 * few hours while "Check for updates automatically" is on. Manual mode asks
 * before each download; automatic mode is standing consent to download and
 * install future updates on quit.
 * Copies that can't update themselves (development, a separate data folder, an
 * app without a Developer ID signature on macOS, the Linux .deb) never contact
 * GitHub; the reason goes to the log and Settings.
 */
export interface UpdaterOptions {
	/** Whether the user wants automatic checks (Settings → General). */
	automatic: () => boolean;
	/** Standing consent to download and install new updates on quit. */
	autoInstall: () => boolean;
	/** Status changes, for the window. */
	onStatus: (status: UpdateStatus) => void;
	/** Saves and stops everything before the app quits to install. */
	beforeInstall: () => Promise<void>;
}

export class Updater {
	status: UpdateStatus = { state: "idle" };
	private support: Promise<Support> | null = null;
	private updater: AppUpdater | null = null;
	private timer: NodeJS.Timeout | null = null;
	private downloadPromise: Promise<UpdateStatus> | null = null;
	private readonly logFile = path.join(app.getPath("logs"), "updates.log");

	constructor(private readonly options: UpdaterOptions) {}

	log(message: string) {
		const line = `${new Date().toISOString()} ${message}`;
		console.info(`[updates] ${message}`);
		void mkdir(path.dirname(this.logFile), { recursive: true })
			.then(() => appendFile(this.logFile, `${line}\n`))
			.catch(() => {});
	}

	/** Called once at launch. */
	async start() {
		const support = await this.supported();
		if (!support.ok) {
			this.log(`Automatic updates are off: ${support.reason}`);
			return;
		}
		this.schedule();
	}

	/** Re-reads the automatic setting (after Settings change). */
	schedule() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		if (!this.options.automatic()) return;
		void this.check(false);
		this.timer = setInterval(() => void this.check(false), UPDATE_INTERVAL_MS);
		this.timer.unref?.();
	}

	/** Looks for a new version; `manual` checks run even when automatic checks are off. */
	async check(manual: boolean): Promise<UpdateStatus> {
		const support = await this.supported();
		if (!support.ok) return this.set({ state: "unsupported", message: support.reason });
		if (!manual && !this.options.automatic()) return this.status;
		if (this.status.state === "ready" || this.status.state === "downloading") return this.status;
		try {
			const updater = await this.load();
			const result = await updater.checkForUpdates();
			if (!result?.isUpdateAvailable)
				return this.set({ state: "idle", checkedAt: new Date().toISOString() });
			return this.status;
		} catch (error) {
			const message = (error as Error).message.split("\n")[0];
			this.log(`Check failed: ${message}`);
			return this.set({ state: "error", message });
		}
	}

	/** Called after explicit Download, or when the user enables automatic updates. */
	async download(): Promise<UpdateStatus> {
		if (this.downloadPromise) return this.downloadPromise;
		if (this.status.state !== "available") return this.status;
		this.downloadPromise = (async () => {
			try {
				const updater = await this.load();
				const installOnQuit = this.options.autoInstall();
				updater.autoInstallOnAppQuit = installOnQuit;
				this.set({ state: "downloading", version: this.status.version, percent: 0, installOnQuit });
				await updater.downloadUpdate();
				return this.status;
			} catch (error) {
				const message = (error as Error).message.split("\n")[0];
				this.log(`Download failed: ${message}`);
				return this.set({ state: "error", message });
			} finally {
				this.downloadPromise = null;
			}
		})();
		return this.downloadPromise;
	}

	/** A preference change applies to future downloads, leaving an in-progress one unchanged. */
	setAutoInstall(enabled: boolean) {
		if (this.updater && this.status.state !== "downloading" && this.status.state !== "ready") {
			this.updater.autoDownload = enabled;
			this.updater.autoInstallOnAppQuit = enabled;
		}
		if (enabled && this.status.state === "available") void this.download();
	}

	/** Quits, installs the downloaded update and reopens Cue. */
	async install() {
		if (this.status.state !== "ready" || !this.updater) return;
		this.log(`Installing ${this.status.version}`);
		await this.options.beforeInstall();
		this.updater.quitAndInstall(true, true);
	}

	private set(status: UpdateStatus): UpdateStatus {
		this.status = status;
		this.options.onStatus(status);
		return status;
	}

	private supported(): Promise<Support> {
		this.support ??= (async () => {
			let signature: MacSignature | undefined;
			if (process.platform === "darwin" && app.isPackaged) signature = await macSignature();
			const support = updateSupport({
				platform: process.platform,
				isPackaged: app.isPackaged,
				env: process.env,
				signature,
			});
			if (!support.ok) this.set({ state: "unsupported", message: support.reason });
			return support;
		})();
		return this.support;
	}

	private async load(): Promise<AppUpdater> {
		if (this.updater) return this.updater;
		// A CommonJS package: its exports arrive as the default export when imported.
		const loaded = (await import("electron-updater")) as typeof import("electron-updater") & {
			default?: typeof import("electron-updater");
		};
		const autoUpdater = loaded.default?.autoUpdater ?? loaded.autoUpdater;
		autoUpdater.autoDownload = this.options.autoInstall();
		autoUpdater.autoInstallOnAppQuit = this.options.autoInstall();
		autoUpdater.allowPrerelease = false;
		autoUpdater.logger = {
			info: (m?: unknown) => this.log(String(m)),
			warn: (m?: unknown) => this.log(`warning: ${String(m)}`),
			error: (m?: unknown) => this.log(`error: ${String(m)}`),
			debug: () => {},
		};
		autoUpdater.on("checking-for-update", () =>
			this.set({ ...this.status, state: "checking", message: undefined }),
		);
		autoUpdater.on("update-available", (info) => {
			const installOnQuit = this.options.autoInstall();
			this.set({
				state: installOnQuit ? "downloading" : "available",
				version: info.version,
				percent: installOnQuit ? 0 : undefined,
				installOnQuit,
				checkedAt: new Date().toISOString(),
			});
		});
		autoUpdater.on("download-progress", (progress) =>
			this.set({ ...this.status, state: "downloading", percent: Math.round(progress.percent) }),
		);
		autoUpdater.on("update-downloaded", (info) => {
			this.log(
				`Downloaded ${info.version}; ${this.status.installOnQuit ? "installs on quit" : "awaiting user restart"}.`,
			);
			this.set({ state: "ready", version: info.version, installOnQuit: this.status.installOnQuit });
		});
		autoUpdater.on("error", (error) => {
			if (this.status.state === "ready") return;
			this.set({ state: "error", message: error.message.split("\n")[0] });
		});
		this.updater = autoUpdater;
		return autoUpdater;
	}
}

/** How the running Cue.app is signed (the updater needs a Developer ID). */
async function macSignature(): Promise<MacSignature> {
	const bundle = path.resolve(process.execPath, "..", "..", "..");
	try {
		const { stderr, stdout } = await run("codesign", ["-dv", "--verbose=2", bundle]);
		return parseCodesign(`${stdout}\n${stderr}`);
	} catch (error) {
		return parseCodesign(String((error as { stderr?: string }).stderr ?? ""));
	}
}
