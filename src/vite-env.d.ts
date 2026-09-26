/// <reference types="vite/client" />
import type { CueApi } from "../electron/preload";

declare global {
	interface Window {
		cue: CueApi;
	}
}
