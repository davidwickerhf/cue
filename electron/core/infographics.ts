import type { DataCallout, Infographic } from "./types";

/**
 * The older data graphics (add_infographic, add_data_callout) as motion graphic
 * templates. They used to be text clips drawn on a canvas; now they are made
 * with the same templates as create_motion_graphic, so agents edit them with
 * update_motion_graphic. Old projects keep their text clips, which still draw.
 */

export type LegacyPalette = Infographic["palette"];

/** The motion theme closest to each old palette. */
export const PALETTE_THEMES: Record<LegacyPalette, string> = {
	editorial: "editorial",
	electric: "signal",
	mono: "mono",
};

/** Cuts text to a template's limit, with an ellipsis when something was cut. */
function shorten(text: string | undefined, max: number): string {
	const value = (text ?? "").trim();
	return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A unit as the templates show it: symbols and short units stick to the number
 * (72%, 14h, 3kg), words get a space (12 stores); a unit too long to follow
 * each number goes in the subtitle instead.
 */
function unitOf(unit: string | undefined, max: number): { unit: string; subtitle: string } {
	const u = (unit ?? "").trim();
	if (!u) return { unit: "", subtitle: "" };
	if (u.length <= 2) return { unit: u, subtitle: "" };
	if (u.length + 1 <= max) return { unit: ` ${u}`, subtitle: "" };
	return { unit: "", subtitle: shorten(`In ${u}`, 120) };
}

function number(value: number) {
	const rounded = Math.round(value * 100) / 100;
	return rounded.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** The template and parameters that draw an old-style infographic. */
export function infographicTemplate(chart: Infographic & { durationMs?: number }): {
	template: string;
	params: Record<string, unknown>;
} {
	const theme = PALETTE_THEMES[chart.palette] ?? "editorial";
	const title = shorten(chart.title, 80);
	const source = shorten(chart.source, 120);
	const timing = chart.durationMs !== undefined ? { durationMs: chart.durationMs } : {};
	const items = chart.items.map((i) => ({ label: shorten(i.label, 40), value: i.value }));
	const chartParams = (extra: Record<string, unknown>) => {
		const { unit, subtitle } = unitOf(chart.unit, 8);
		return {
			theme,
			title,
			...(subtitle ? { subtitle } : {}),
			...(source ? { source } : {}),
			...(unit ? { unit } : {}),
			// Over the footage, like the printed sheet the old graphics drew.
			backdrop: "card",
			...timing,
			...extra,
		};
	};
	const bars = () => ({
		template: "bar-chart",
		// The old bars drew the first row in the accent colour.
		params: chartParams({ items, highlight: 0 }),
	});
	switch (chart.kind) {
		case "donut":
			return { template: "donut-chart", params: chartParams({ items }) };
		case "line":
			// A trend needs two points; one value is a bar.
			return items.length >= 2
				? { template: "line-chart", params: chartParams({ points: items }) }
				: bars();
		case "cards": {
			// Up to four cards fit side by side; more values compare better as bars.
			if (items.length > 4) return bars();
			const u = (chart.unit ?? "").trim();
			const suffix = u.length <= 2 ? u : u.length <= 5 ? ` ${u}` : "";
			return {
				template: "stat-row",
				params: {
					theme,
					title,
					stats: chart.items.map((i) => ({
						value: i.value,
						suffix,
						label: shorten(suffix || !u ? i.label : `${i.label} (${u})`, 40),
					})),
					// The cards are opaque: the footage shows around them.
					backdrop: "none",
					...timing,
				},
			};
		}
		case "timeline": {
			if (items.length < 2) return bars();
			const { unit } = unitOf(chart.unit, 24);
			return {
				template: "timeline",
				params: {
					theme,
					title,
					// Each milestone: its label above the point, its value (and unit) below.
					items: chart.items.map((i) => ({
						date: shorten(i.label, 20),
						label: shorten(`${number(i.value)}${unit}`, 40),
					})),
					...timing,
				},
			};
		}
		default:
			return bars();
	}
}

/** The callout template and parameters that draw an old-style data callout. */
export function dataCalloutTemplate(callout: DataCallout & { durationMs?: number }): {
	template: string;
	params: Record<string, unknown>;
} {
	return {
		template: "callout",
		params: {
			theme: PALETTE_THEMES[callout.palette] ?? "editorial",
			label: shorten(callout.label, 40),
			...(callout.value ? { value: shorten(callout.value, 30) } : {}),
			...(callout.source ? { source: shorten(callout.source, 80) } : {}),
			targetX: callout.targetX,
			targetY: callout.targetY,
			labelX: callout.x,
			labelY: callout.y,
			...(callout.durationMs !== undefined ? { durationMs: callout.durationMs } : {}),
		},
	};
}
