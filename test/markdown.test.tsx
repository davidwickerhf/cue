import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/components/ui/Markdown";

const reply = `I added the sound effects.

**Music:** send me a track and I'll put it on the Music track (A2).

**Sound effects:** 26 of them on a new SFX track:
- **Title chime** at 0:00.
- **Click ticks** (14) where clicks change the screen.
  - nested detail
- Running \`auto_mix\` fixes it, see [the guide](https://cue.wicker.life/docs).

1. first
2. second`;

describe("agent replies as markdown", () => {
	const html = renderToStaticMarkup(<Markdown text={reply} />);
	it("renders bold, lists, code and links instead of raw markdown", () => {
		expect(html).not.toContain("**");
		expect(html).toContain('<strong class="font-semibold">Music:</strong>');
		expect(html).toContain("<ul");
		expect(html).toContain("<ol");
		expect(html).toContain("<code");
		expect(html).toContain('href="https://cue.wicker.life/docs"');
		expect(html.match(/<li>/g)?.length).toBe(6);
	});
	it("never passes HTML through", () => {
		const evil = renderToStaticMarkup(
			<Markdown text={'<img src=x onerror="alert(1)"> [x](javascript:alert(1))'} />,
		);
		expect(evil).not.toContain("<img");
		expect(evil).not.toContain("javascript:");
	});
});
