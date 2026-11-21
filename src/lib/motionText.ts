// The text layers of a motion graphic made in Cue, as the inspector edits them.

export type SpecJson = { layers?: SpecJson[]; type?: string; name?: string; text?: string };

/** A graphic's text layers in the order its spec lists them (groups included), with their paths. */
export function specTexts(
	spec: SpecJson,
	prefix = "",
): { path: string; name?: string; text: string }[] {
	return (spec.layers ?? []).flatMap((l, i) => {
		const path = prefix ? `${prefix}.${i}` : String(i);
		if (l.type === "group") return specTexts(l, path);
		return l.type === "text" ? [{ path, name: l.name, text: l.text ?? "" }] : [];
	});
}

/** The spec with one text layer's text changed, or the layer removed (null). */
export function withSpecText(spec: SpecJson, path: string, text: string | null): SpecJson {
	const [head, ...rest] = path.split(".").map(Number);
	const layers = [...(spec.layers ?? [])];
	if (rest.length) layers[head] = withSpecText(layers[head], rest.join("."), text);
	else if (text === null) layers.splice(head, 1);
	else layers[head] = { ...layers[head], text };
	return { ...spec, layers };
}
