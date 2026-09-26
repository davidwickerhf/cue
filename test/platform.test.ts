import { describe, expect, it } from "vitest";
import { parseCodesign, updateSupport } from "../electron/core/updates";
import { keyLabel } from "../src/lib/platform";

describe("shortcut labels", () => {
	it("keeps macOS symbols on a Mac", () => {
		expect(keyLabel("⇧⌘Z", true)).toBe("⇧⌘Z");
	});
	it("spells shortcuts out elsewhere, Ctrl first", () => {
		expect(keyLabel("⇧⌘Z", false)).toBe("Ctrl+Shift+Z");
		expect(keyLabel("⌘,", false)).toBe("Ctrl+,");
		expect(keyLabel("⌥X", false)).toBe("Alt+X");
		expect(keyLabel("⇧⌫", false)).toBe("Shift+Backspace");
		expect(keyLabel("⌫", false)).toBe("Backspace");
		expect(keyLabel("⌘ scroll", false)).toBe("Ctrl scroll");
		expect(keyLabel("⌥ drag", false)).toBe("Alt drag");
		expect(keyLabel("⇧←", false)).toBe("Shift+←");
	});
	it("rewrites shortcuts inside sentences", () => {
		expect(keyLabel("Restored. ⌘Z to go back.", false)).toBe("Restored. Ctrl+Z to go back.");
		expect(keyLabel("All projects (⇧⌘O)", false)).toBe("All projects (Ctrl+Shift+O)");
		expect(keyLabel("Space plays, ⌘K splits", false)).toBe("Space plays, Ctrl+K splits");
	});
});

describe("update support", () => {
	const packaged = { isPackaged: true, env: {} };
	it("reads codesign output", () => {
		expect(
			parseCodesign(
				"Executable=/Applications/Cue.app/Contents/MacOS/Cue\nAuthority=Developer ID Application: Jane Doe (ABCDE12345)\nAuthority=Developer ID Certification Authority",
			),
		).toEqual({
			kind: "developer-id",
			authority: "Developer ID Application: Jane Doe (ABCDE12345)",
		});
		expect(parseCodesign("Authority=Apple Development: jane@example.com (XYZ)").kind).toBe("other");
		expect(parseCodesign("Signature=adhoc\nTeamIdentifier=not set").kind).toBe("adhoc");
		expect(parseCodesign("/Applications/Cue.app: code object is not signed at all").kind).toBe(
			"unsigned",
		);
	});
	it("needs a Developer ID on macOS", () => {
		expect(
			updateSupport({
				...packaged,
				platform: "darwin",
				signature: { kind: "developer-id", authority: "Developer ID Application: X" },
			}),
		).toEqual({ ok: true });
		const adhoc = updateSupport({ ...packaged, platform: "darwin", signature: { kind: "adhoc" } });
		expect(adhoc.ok).toBe(false);
		expect(!adhoc.ok && adhoc.reason).toMatch(/Developer ID/);
	});
	it("is off in development and with a separate data folder", () => {
		expect(updateSupport({ platform: "win32", isPackaged: false, env: {} }).ok).toBe(false);
		expect(
			updateSupport({ ...packaged, platform: "win32", env: { CUE_USER_DATA: "/tmp/x" } }).ok,
		).toBe(false);
	});
	it("updates Windows installs and AppImages, not .deb installs", () => {
		expect(updateSupport({ ...packaged, platform: "win32" }).ok).toBe(true);
		expect(
			updateSupport({ ...packaged, platform: "linux", env: { APPIMAGE: "/x/Cue.AppImage" } }).ok,
		).toBe(true);
		expect(updateSupport({ ...packaged, platform: "linux" }).ok).toBe(false);
	});
});
