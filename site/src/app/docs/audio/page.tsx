import { A, C, DocPage, H2, H3, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/audio");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "clip-sound", label: "Clip volume and fades" },
	{ id: "mixer", label: "The mixer" },
	{ id: "ducking", label: "Ducking" },
	{ id: "voiceover", label: "Voiceover" },
	{ id: "denoise", label: "Denoise and loudness" },
	{ id: "beats", label: "Beats" },
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					Video tracks play their clips&apos; sound, and audio tracks hold music, voiceover and effects. The Audio workspace (
					<Kbd>⌥2</Kbd>) docks the mixer beside the viewer and makes audio tracks tall, with waveforms and volume lines.
				</p>
			}
		>
			<H2 id="clip-sound">Clip volume and fades</H2>
			<Ul>
				<li>
					The inspector&apos;s <strong className="text-white">Audio</strong> section sets a clip&apos;s volume (0 to 200%) and its fade in and
					fade out.
				</li>
				<li>
					Clips with sound draw their waveform, and a volume line you can drag up or down to set the level, as in Premiere.
				</li>
				<li>
					Volume can be keyframed like position and scale (see <A href="/docs/look-and-motion#keyframes">keyframes</A>); the volume line
					follows the keyframes.
				</li>
				<li>Right-click a clip to mute or unmute it, or to detach a video clip&apos;s sound onto its own audio track.</li>
			</Ul>

			<H2 id="mixer">The mixer</H2>
			<p>
				Open the Mixer panel in the sidebar, or switch to the Audio workspace to have it docked beside the viewer. There is one
				strip for every track that can make sound (audio tracks, and video tracks with sound on them):
			</p>
			<Ul>
				<li>
					<strong className="text-white">Level</strong>: the track&apos;s volume, 0 to 200%.
				</li>
				<li>
					<strong className="text-white">Pan</strong>: left to right.
				</li>
				<li>
					<strong className="text-white">Mute</strong> and <strong className="text-white">Solo</strong>: when any track is soloed, only soloed
					tracks are heard.
				</li>
				<li>A live peak meter from -48 dBFS to 0, green to red.</li>
			</Ul>
			<p>The Master strip at the bottom shows the left and right meters of the whole mix.</p>

			<H2 id="ducking">Ducking under the voiceover</H2>
			<Ol>
				<li>
					Mark the track with your narration as the voiceover track: track menu → <strong className="text-white">Voiceover</strong>.
				</li>
				<li>
					On the music track, choose <strong className="text-white">Duck under voiceover</strong> (&quot;Lower while the voiceover
					speaks&quot;).
				</li>
			</Ol>
			<p>The music dips while the voiceover speaks, in playback and in the export. The track header shows &quot;Ducks under voice&quot;.</p>

			<H2 id="voiceover">Voiceover</H2>
			<p>
				Cue has a small recording booth for narration. The script is a list of timed lines on the timeline; you record takes
				for each line against a teleprompter and keep the best one. The Voiceover workspace (<Kbd>⌥4</Kbd>) puts the script
				beside the viewer with the prompter on the picture.
			</p>
			<H3>The script</H3>
			<Ul>
				<li>
					Open the Voiceover panel. Add lines with <strong className="text-white">New line</strong> or <strong className="text-white">Add line at playhead</strong>,
					or import a script from an <C>.srt</C> or <C>.json</C> file.
				</li>
				<li>
					Each line has where it <strong className="text-white">Starts</strong>, a <strong className="text-white">Target</strong> length and a{" "}
					<strong className="text-white">Max</strong> length. Its status shows whether its take fits: Fits, Tight, Too long or No take.
				</li>
				<li>
					The line menu can play the line, import a take from a file, rewrite the line (Fit, Shorter or Clearer, with the text
					model) or delete it. Deleting a line keeps its takes in the Media panel.
				</li>
				<li>
					<strong className="text-white">Script from footage</strong> in the Generate panel turns the speech in a video into script lines, timed
					where they are spoken, so you can re-record it.
				</li>
			</Ul>
			<H3>Recording takes</H3>
			<Ol>
				<li>Choose your microphone in the Voiceover panel.</li>
				<li>
					Select a line and press <Kbd>R</Kbd> (or Record). Playback rolls from the pre-roll and the line appears on the teleprompter.
				</li>
				<li>
					Press <Kbd>Space</Kbd> to stop and keep the take, or <Kbd>Esc</Kbd> to discard it. Recording can also stop by itself after
					the line&apos;s max length.
				</li>
				<li>Every take is kept. Listen to them and choose <strong className="text-white">Use this take</strong> for the best one.</li>
			</Ol>
			<p>
				Pre-roll, post-roll, trim padding, the silence level, auto-stop and what you hear while recording (nothing, or the
				timeline) are in the project settings under Recording.
			</p>
			<H3>Generated voices</H3>
			<p>
				<strong className="text-white">Generate a voice take</strong> on a line speaks it with a voice instead of recording, and the Generate
				panel can voice every missing line at once. Use a macOS voice on your Mac, or OpenAI&apos;s voices with delivery
				instructions (&quot;calm, warm, unhurried&quot;). A generated take is a take like any other.
			</p>

			<H2 id="denoise">Denoise and loudness</H2>
			<Ul>
				<li>
					<strong className="text-white">Denoise</strong> cleans up low rumble and steady background noise on a clip (a high-pass filter and FFT noise reduction). It is
					applied when you export and is set by an agent or the <C>update_clip</C> tool: ask &quot;Denoise the interview clips&quot;.
					There is no button for it in the inspector yet.
				</li>
				<li>
					<strong className="text-white">Normalise loudness</strong> in the project settings (Export section) evens out the level of the
					exported mix.
				</li>
			</Ul>

			<H2 id="beats">Beats and cutting to the music</H2>
			<p>In the Generate panel, the Music section works on a music item from your project:</p>
			<Table
				head={["Button", "What it does"]}
				rows={[
					[
						"Mark the beats",
						"Finds the tempo (BPM) and puts a green Beat marker on every beat where the music is used on the timeline. It warns when the pulse is weak.",
					],
					[
						"Cut to the beat",
						"Moves each cut on a video track to the nearest beat with rolling edits, so the timing of everything else stays.",
					],
				]}
			/>
			<p>Clear the beat markers from the markers list (Clear beats) when you are done.</p>
			<Note>
				Agents can mark only every Nth beat and set how far a cut may move with <C>detect_beats</C> and <C>snap_cuts_to_beats</C>. To
				cut pauses out of speech, ask for <C>remove_silence</C>.
			</Note>
		</DocPage>
	);
}
