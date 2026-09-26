import { A, C, DocPage, H2, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/look-and-motion");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "transform", label: "Transform and crop" },
	{ id: "keyframes", label: "Keyframes" },
	{ id: "zooms", label: "Zooms" },
	{ id: "colour", label: "Colour and LUTs" },
	{ id: "effects", label: "Effects" },
	{ id: "masks", label: "Masks" },
	{ id: "chroma-key", label: "Chroma key" },
	{ id: "adjustment-layers", label: "Adjustment layers" },
	{ id: "transitions", label: "Transitions" },
	{ id: "scopes", label: "Scopes and compare" },
	{ id: "layouts", label: "Split screen and picture in picture" },
	{ id: "overlays", label: "Shapes and overlays" },
];

/** How each transition looks (electron/core/transitions.ts and the add_transition tool). */
const TRANSITION_NOTES: Record<string, string> = {
	crossfade: "The incoming clip fades in over the outgoing one.",
	dip: "Fades out to black and back in. The only kind that does not overlap the clips.",
	"wipe-left": "A hard edge sweeps across to the left, revealing the incoming clip.",
	"wipe-right": "A hard edge sweeps across to the right.",
	"slide-left": "The incoming clip slides in from the right.",
	"slide-right": "The incoming clip slides in from the left.",
	zoom: "The incoming clip settles in from slightly larger while it fades in.",
	blur: "The incoming clip sharpens from a blur while it fades in.",
};

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					Position and animate clips, grade them, add effects, masks and keys, and join them with transitions. Everything here
					is set in the inspector for the selected clip, and the preview matches the export.
				</p>
			}
		>
			<H2 id="transform">Transform and crop</H2>
			<Ul>
				<li>
					<strong className="text-white">Transform</strong>: X and Y are the clip&apos;s centre as a share of the frame (0 to 1, 0.5 is the
					middle), Scale 1 fits the frame, and Opacity.
				</li>
				<li>
					<strong className="text-white">Crop</strong>: left, top, right and bottom, each up to 45% of the picture.
				</li>
			</Ul>

			<H2 id="keyframes">Keyframes</H2>
			<p>
				X, Y, Scale and Volume can change over a clip. Put the playhead inside the clip and press the keyframe button next to a
				value to add a keyframe there; change the value at another time to add another. The same button removes the keyframe
				under the playhead. With keyframes on a clip, the inspector follows the playhead and shows the value at that moment.
			</p>
			<p>
				Keyframes made in the inspector ease in and out. Agents can also set linear or hold keyframes with <C>set_keyframe</C>. There is no keyframe
				lane or curve editor yet.
			</p>

			<H2 id="zooms">Zooms</H2>
			<p>
				A zoom pushes in on part of a video clip and back out, like a screen recorder&apos;s auto-zoom. Right-click a clip and
				choose <strong className="text-white">Zoom in here</strong>, then adjust it in the inspector&apos;s Zoom section: From and To (times
				inside the clip), Amount, Focus X and Y (the point to zoom into) and Ease (how long it takes to push in and out).
			</p>

			<H2 id="colour">Colour and LUTs</H2>
			<Table
				head={["Control", "Range"]}
				rows={[
					["Brightness", "-1 to 1"],
					["Contrast", "0 to 3 (1 is unchanged)"],
					["Saturation", "0 to 3 (1 is unchanged; 0 is black and white)"],
					["Temperature", "-1 (cooler) to 1 (warmer)"],
					["LUT", "Any .cube file, chosen with Choose a .cube LUT"],
				]}
			/>
			<p>
				Grade one clip at a time, or put an <A href="#adjustment-layers">adjustment layer</A> over a stretch of the timeline to grade
				everything under it.
			</p>

			<H2 id="effects">Effects</H2>
			<Table
				head={["Effect", "What it does"]}
				rows={[
					["Blur", "Softens the picture, 0 to 1."],
					["Sharpen", "Crisps up detail, 0 to 1."],
					["Vignette", "Darkens the corners, 0 to 1."],
					["Glow", "Adds a soft, blurred glow over the picture, 0 to 1."],
					["Stabilise", "Smooths out shaky footage, zooming in slightly to hide the moving edges. It is analysed when you export, so the preview shows the clip unstabilised."],
				]}
			/>
			<p>
				On an adjustment layer, blur, sharpen and vignette apply to everything below it: a blurred background behind a title,
				for example.
			</p>

			<H2 id="masks">Masks</H2>
			<p>
				A mask shows only part of a clip. Choose a rectangle or an ellipse and set its centre X and Y, width and height (as
				shares of the picture), and a feather for a soft edge. <strong className="text-white">Invert</strong> shows the outside of the shape
				instead. Masks work on adjustment layers too, to grade or blur just one area.
			</p>

			<H2 id="chroma-key">Chroma key</H2>
			<p>
				Chroma key removes a green or blue screen. Start with <strong className="text-white">Green screen</strong> or{" "}
				<strong className="text-white">Blue screen</strong>, or type a colour or use <strong className="text-white">Pick from screen</strong>. Then raise{" "}
				<strong className="text-white">Similarity</strong> until the background is gone and use <strong className="text-white">Edge softness</strong> to
				blend the edges. Put the keyed clip on a track above the background you want to show through.
			</p>

			<H2 id="adjustment-layers">Adjustment layers</H2>
			<Ol>
				<li>
					In the Media panel, choose <strong className="text-white">New adjustment layer at the playhead</strong>. It goes on a new top
					track.
				</li>
				<li>Trim it to the stretch of time you want, like any clip.</li>
				<li>Set its colour, effects and mask. They apply to every track below it for as long as it lasts.</li>
			</Ol>
			<p>Adjustment layers have timing, colour, effects and a mask; they have no picture or sound of their own.</p>

			<H2 id="transitions">Transitions</H2>
			<p>
				A transition leads into a clip from the clip right before it on the same track. Select clips and press <Kbd>⌘D</Kbd> for a
				crossfade, right-click for a crossfade or dip to black, or pick any kind and its length in the inspector&apos;s{" "}
				<strong className="text-white">Transition in</strong> section.
			</p>
			<Table
				head={["Transition", "Look"]}
				rows={appData.transitions.map((t) => [t.label, TRANSITION_NOTES[t.kind] ?? ""])}
			/>
			<p>
				Every kind except the dip overlaps the two clips (later clips move left by the length of the overlap) and crossfades
				their sound. Adding a transition to a clip that has one replaces it; removing a crossfade undoes the overlap.
			</p>

			<H2 id="scopes">Scopes and compare</H2>
			<p>The Colour workspace (<Kbd>⌥3</Kbd>) docks scopes beside the viewer and opens the colour tools in the inspector.</p>
			<Ul>
				<li>
					<strong className="text-white">Waveform</strong>: brightness across the picture, 0 to 100, with guides every 25.
				</li>
				<li>
					<strong className="text-white">Vectorscope</strong>: hue and saturation, with the skin-tone line that faces should sit along.
				</li>
				<li>
					<strong className="text-white">Histogram</strong>: red, green and blue levels.
				</li>
				<li>
					<strong className="text-white">Hold to compare</strong>: hold the button on the viewer to see the picture without its grade and
					effects, and let go to see it graded again.
				</li>
			</Ul>

			<H2 id="layouts">Split screen and picture in picture</H2>
			<p>
				Select clips that play at the same time on different video tracks and pick a layout under{" "}
				<strong className="text-white">Arrange on screen</strong> in the inspector: side by side, top and bottom, three across, a grid of
				four, or picture in picture in any corner (the clip on the higher track becomes the small one). Each picture fills its area,
				centre-cropped. A single clip can be made small in a corner or put back to full frame. Agents use <C>arrange_clips</C>.
			</p>

			<H2 id="overlays">Shapes and overlays</H2>
			<p>
				In the Text panel, <strong className="text-white">Shapes and overlays</strong> adds, at the playhead: a box, a circle, an arrow,
				a callout (a box with text), a blur box that blurs whatever is under it, and a redaction (a solid box). Graphics sit on their own
				Graphics tracks, pop in like titles, and can be moved and resized on the viewer. The inspector&apos;s Shape section changes the
				kind, size, line and fill. Agents use <C>add_overlay</C>.
			</p>
			<Note>
				You can turn the compare button on in any workspace from the workspace menu (On the viewer → Before/after button), and
				dock the scopes from Beside the viewer.
			</Note>
		</DocPage>
	);
}
