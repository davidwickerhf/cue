import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
	const listeners = new Map<string, Array<(value?: unknown) => void>>();
	const updater = {
		autoDownload: true,
		autoInstallOnAppQuit: true,
		allowPrerelease: true,
		logger: null as unknown,
		on(event: string, listener: (value?: unknown) => void) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		emit(event: string, value?: unknown) {
			for (const listener of listeners.get(event) ?? []) listener(value);
		},
		checkForUpdates: vi.fn(),
		downloadUpdate: vi.fn(),
		quitAndInstall: vi.fn(),
	};
	return { updater, listeners };
});

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("electron-updater", () => ({
	autoUpdater: fake.updater,
	default: { autoUpdater: fake.updater },
}));

import { Updater } from "../electron/updater";

beforeEach(() => {
	fake.listeners.clear();
	fake.updater.autoDownload = true;
	fake.updater.autoInstallOnAppQuit = true;
	vi.clearAllMocks();
	fake.updater.downloadUpdate.mockImplementation(async () => {
		fake.updater.emit("update-downloaded", { version: "0.2.0" });
		return [];
	});
	fake.updater.checkForUpdates.mockImplementation(async () => {
		fake.updater.emit("update-available", { version: "0.2.0" });
		if (fake.updater.autoDownload) await fake.updater.downloadUpdate();
		return { isUpdateAvailable: true };
	});
});

function makeUpdater(automaticInstall: () => boolean) {
	const updater = new Updater({
		automatic: () => true,
		autoInstall: automaticInstall,
		onStatus: vi.fn(),
		beforeInstall: vi.fn(),
	});
	Object.defineProperty(updater, "supported", { value: async () => ({ ok: true }) });
	return updater;
}

describe("update consent", () => {
	it("checks without downloading until the user chooses Download", async () => {
		const updater = makeUpdater(() => false);
		expect((await updater.check(true)).state).toBe("available");
		expect(fake.updater.autoDownload).toBe(false);
		expect(fake.updater.downloadUpdate).not.toHaveBeenCalled();
		expect((await updater.download()).state).toBe("ready");
		expect(fake.updater.downloadUpdate).toHaveBeenCalledOnce();
		expect(fake.updater.autoInstallOnAppQuit).toBe(false);
	});

	it("uses standing consent to download new updates and install on quit", async () => {
		const updater = makeUpdater(() => true);
		expect((await updater.check(false)).state).toBe("ready");
		expect(fake.updater.autoDownload).toBe(true);
		expect(fake.updater.downloadUpdate).toHaveBeenCalledOnce();
		expect(fake.updater.autoInstallOnAppQuit).toBe(true);
		expect(updater.status.installOnQuit).toBe(true);
	});

	it("downloads an available update when automatic installation is enabled", async () => {
		let enabled = false;
		const updater = makeUpdater(() => enabled);
		expect((await updater.check(false)).state).toBe("available");
		enabled = true;
		updater.setAutoInstall(true);
		await vi.waitFor(() => expect(updater.status.state).toBe("ready"));
		expect(fake.updater.downloadUpdate).toHaveBeenCalledOnce();
		expect(updater.status.installOnQuit).toBe(true);
	});
});
