/** Vite packages the same rendered studies that the website serves. */
const videos = import.meta.glob("../../resources/styles/previews/*.mp4", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;
const posters = import.meta.glob("../../resources/styles/previews/*.jpg", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;

export function stylePreview(file: string, kind: "video" | "poster"): string | undefined {
	const collection = kind === "video" ? videos : posters;
	return Object.entries(collection).find(([path]) => path.endsWith(`/${file}`))?.[1];
}
