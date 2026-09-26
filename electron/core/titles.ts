import type { TextAnimation, TextStyle } from "./types";

/**
 * Title templates: starting points for text, shared by the Text panel and
 * the agent's add_text tool. Every value can be changed afterwards.
 */
export const TITLE_IDS = [
	"title",
	"headline",
	"outline",
	"gradient",
	"lower-third",
	"caption",
	"subtitle",
	"minimal",
	"quote",
	"label",
	"big-number",
] as const;

export type TitleId = (typeof TITLE_IDS)[number];

export interface TitleTemplate {
	label: string;
	sample: string;
	style: Partial<TextStyle>;
	animationIn?: TextAnimation;
	animationOut?: TextAnimation;
}

export const TITLE_TEMPLATES: Record<TitleId, TitleTemplate> = {
	title: {
		label: "Title",
		sample: "Big title",
		style: { fontSize: 96, fontWeight: 800, y: 0.45, width: 0.8, background: null, shadow: true },
		animationIn: "pop",
		animationOut: "fade",
	},
	headline: {
		label: "Headline",
		sample: "Headline",
		style: {
			fontSize: 120,
			fontWeight: 900,
			y: 0.45,
			width: 0.9,
			background: null,
			shadow: true,
			letterSpacing: -2,
			lineHeight: 1.05,
		},
		animationIn: "slide-up",
		animationOut: "fade",
	},
	outline: {
		label: "Outline",
		sample: "OUTLINE",
		style: {
			fontSize: 110,
			fontWeight: 900,
			y: 0.45,
			width: 0.9,
			background: null,
			shadow: false,
			color: "#ffffff",
			strokeColor: "#000000",
			strokeWidth: 6,
			uppercase: true,
		},
		animationIn: "zoom",
		animationOut: "fade",
	},
	gradient: {
		label: "Gradient",
		sample: "Gradient",
		style: {
			fontSize: 110,
			fontWeight: 900,
			y: 0.45,
			width: 0.9,
			background: null,
			shadow: true,
			color: "#f9a8d4",
			gradientTo: "#818cf8",
		},
		animationIn: "pop",
		animationOut: "fade",
	},
	"lower-third": {
		label: "Lower third",
		sample: "Name · Role",
		style: {
			fontSize: 44,
			fontWeight: 700,
			x: 0.3,
			y: 0.82,
			width: 0.5,
			align: "left",
			background: "rgba(15, 23, 42, 0.78)",
		},
		animationIn: "slide-left",
		animationOut: "fade",
	},
	caption: {
		label: "Caption",
		sample: "Subtitle text",
		style: { fontSize: 46, fontWeight: 600, y: 0.9, width: 0.86, padding: 14, radius: 10 },
	},
	subtitle: {
		label: "Yellow subtitle",
		sample: "Subtitle text",
		style: {
			fontSize: 48,
			fontWeight: 700,
			y: 0.88,
			width: 0.86,
			background: null,
			shadow: false,
			color: "#facc15",
			strokeColor: "#000000",
			strokeWidth: 4,
		},
	},
	minimal: {
		label: "Minimal",
		sample: "MINIMAL",
		style: {
			fontSize: 52,
			fontWeight: 400,
			y: 0.5,
			width: 0.8,
			background: null,
			shadow: false,
			uppercase: true,
			letterSpacing: 14,
		},
		animationIn: "fade",
		animationOut: "fade",
	},
	quote: {
		label: "Quote",
		sample: "“A line worth quoting.”",
		style: {
			fontFamily: "Georgia",
			fontSize: 64,
			fontWeight: 500,
			italic: true,
			y: 0.5,
			width: 0.75,
			background: null,
			shadow: true,
			lineHeight: 1.3,
		},
		animationIn: "fade",
		animationOut: "fade",
	},
	label: {
		label: "Label",
		sample: "Label",
		style: {
			fontSize: 32,
			fontWeight: 600,
			x: 0.84,
			y: 0.1,
			width: 0.28,
			background: "rgba(37, 99, 235, 0.9)",
			radius: 999,
			padding: 12,
		},
		animationIn: "pop",
		animationOut: "fade",
	},
	"big-number": {
		label: "Big number",
		sample: "87%",
		style: {
			fontSize: 220,
			fontWeight: 900,
			y: 0.45,
			width: 0.6,
			background: null,
			shadow: true,
			letterSpacing: -6,
			lineHeight: 1,
		},
		animationIn: "zoom",
		animationOut: "fade",
	},
};
