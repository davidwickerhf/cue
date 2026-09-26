/**
 * The platform the editor runs on, and shortcut labels for it. Shortcuts are
 * written the macOS way (⇧⌘Z) throughout the UI; elsewhere they read as
 * Ctrl+Shift+Z, since ⌘ shortcuts are Ctrl shortcuts there.
 */
export const platform: string =
	(typeof window !== "undefined" && (window as { cue?: { platform?: string } }).cue?.platform) ||
	"darwin";
export const isMac = platform === "darwin";

const MODIFIERS: [symbol: string, name: string][] = [
	["⌘", "Ctrl"],
	["⌃", "Ctrl"],
	["⌥", "Alt"],
	["⇧", "Shift"],
];
const KEYS: Record<string, string> = { "⌫": "Backspace", "⌦": "Delete", "↩": "Enter", "⎋": "Esc" };

/** "⇧⌘Z" → "Ctrl+Shift+Z" off macOS; any text is accepted and only its shortcuts change. */
export function keyLabel(text: string, mac = isMac): string {
	if (mac || !text) return text;
	return text
		.replace(/([⌘⌃⌥⇧]+)(⌫|⌦|↩|⎋|[^\s⌘⌃⌥⇧])?/g, (_match, mods: string, key?: string) => {
			const names = [
				...new Set(MODIFIERS.filter(([symbol]) => mods.includes(symbol)).map(([, name]) => name)),
			];
			return key ? [...names, KEYS[key] ?? key].join("+") : names.join("+");
		})
		.replace(/[⌫⌦↩⎋]/g, (key) => KEYS[key]);
}

/** "Mac" in user-facing text, or "computer" elsewhere. */
export const thisComputer = isMac ? "this Mac" : "this computer";
