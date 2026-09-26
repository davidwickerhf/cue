import { createStore } from "./state";

/** How far the viewer is zoomed in: a multiple of the size that fits (1 = Fit), and that size's width. */
export const viewerZoom = createStore({ scale: 1, fitWidth: 0 });

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/** Screen pixels per canvas pixel when the viewer is fitted (from the stage's current width). */
export function fittedRatio(canvasWidth: number): number {
	const width = viewerZoom.get().fitWidth || canvasWidth;
	return (width * window.devicePixelRatio) / canvasWidth;
}

/** Zooms to a share of the canvas's real pixels (1 = one canvas pixel per screen pixel), or fits. */
export function zoomViewer(percent: number | "fit", canvasWidth: number) {
	if (percent === "fit") return viewerZoom.set({ scale: 1 });
	const scale = percent / 100 / fittedRatio(canvasWidth);
	viewerZoom.set({ scale: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)) });
}
