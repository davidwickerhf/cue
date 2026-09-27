import { A, C, DocPage, H2, H3, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import tools from "@/content/tools.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";
import { AgentConnect } from "@/components/AgentConnect";

const PAGE = doc("/docs/ai-and-agents");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "how", label: "How it works" },
	{ id: "agent-panel", label: "The Agent panel" },
	{ id: "mcp", label: "Connect an MCP client" },
	{ id: "review", label: "Reviewing agent edits" },
	{ id: "limits", label: "What agents can and cannot do" },
	{ id: "prompts", label: "Example prompts" },
	{ id: "models", label: "Local and cloud models" },
];

const PROMPTS = [
	"Transcribe the interview, cut the filler words and add captions.",
	"Find where they talk about pricing and make that the opening.",
	"Mark the beats in the music and move the cuts onto them.",
	"Make a vertical version and follow the speaker with the crop.",
	"Render the frame at 1:15 and tell me if the title is readable.",
	"Tighten the edit: cut pauses longer than a second.",
	"Add captions to the voiceover and keep them to two short lines.",
	"Look at the frame at the playhead and tell me what could look better.",
	"Which script lines are over their time slot?",
	"Split this long take at its shot changes and put a marker on each shot.",
	"Make 15 and 30 second vertical cuts from the best moments.",
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					An AI agent can edit a Cue project with the same actions you use: {tools.count} tools covering editing, titles, audio,
					colour, voiceover, generation and export. You watch the changes appear on the timeline, and every one of them can be
					undone.
				</p>
			}
		>
			<H2 id="how">How it works</H2>
			<p>
				One contract defines every action in Cue. The editor window, the in-app chat and the MCP server all call it, so an
				agent&apos;s edit is recorded, attributed and undoable exactly like yours, and it shows up in the{" "}
				<A href="/docs/projects-and-history#history">history</A> as made by an agent. Every agent also receives the same written
				guide to editing in Cue (the <C>get_guide</C> tool returns it).
			</p>
			<p>There are two ways in:</p>
			<Ul>
				<li>
					<strong className="text-white">The Agent panel</strong> inside Cue, which runs a coding agent you already have installed.
				</li>
				<li>
					<strong className="text-white">Any MCP client</strong> on your Mac, such as Claude Code in a terminal.
				</li>
			</Ul>

			<H2 id="agent-panel">The Agent panel</H2>
			<p>
				Open the Agent panel in the sidebar, or the Agent workspace (<Kbd>⌥6</Kbd>), which puts the chat in a wide sidebar with the
				history docked beside the viewer. Cue finds these agents if they are installed, and runs them signed in with your own
				account:
			</p>
			<Table
				head={["Agent", "Install", "Models to pick from"]}
				rows={[
					["Claude Code", <C key="c">npm install -g @anthropic-ai/claude-code</C>, "Default, Sonnet, Opus, Haiku"],
					["Codex", <C key="c">npm install -g @openai/codex</C>, "Default"],
					["Gemini CLI", <C key="c">npm install -g @google/gemini-cli</C>, "Default, 2.5 Pro, 2.5 Flash"],
				]}
			/>
			<Ul>
				<li>
					Each message tells the agent what you see: the playhead, your selection and the in and out points. So &quot;make this
					clip black and white&quot; works on the selected clip.
				</li>
				<li>
					Right-click a clip and choose <strong className="text-white">Ask the agent about this…</strong> to start a message about it.
				</li>
				<li>
					The agent gets Cue&apos;s tools only: no shell, no files and no web. Tool calls show in the chat as they run, and the
					cost of the conversation shows under the box when the agent reports it.
				</li>
				<li>Use the stop button to end a run, and the new-conversation button to start fresh.</li>
			</Ul>

			<H2 id="mcp">Connect an MCP client</H2>
			<p>With Cue in Applications, pick your agent and run its command once in a terminal (or add the config it shows):</p>
			<AgentConnect />
			<p>
				Claude Code, Codex, Gemini CLI, VS Code, Cursor, Claude Desktop and any other MCP client start the same server:{" "}
				<C>node</C> with the path to <C>cue-mcp.mjs</C> inside the app. You can copy it from <strong className="text-white">Settings → Agent</strong> or from the Agent
				panel&apos;s <strong className="text-white">Connect &amp; activity</strong> tab, which also shows whether an agent is connected and
				what it has done.
			</p>
			<Ul>
				<li>The server starts Cue when needed.</li>
				<li>
					It talks to Cue on this Mac only, over a loopback connection with a token that changes every launch.
				</li>
				<li>
					<strong className="text-white">Settings → Agent → Allow agents to control Cue</strong> turns outside access off entirely.
				</li>
			</Ul>

			<H2 id="review">Reviewing agent edits</H2>
			<p>
				Turn on <strong className="text-white">Review edits</strong> under the chat box (or <strong className="text-white">Settings → Agent → Review agent edits</strong>) to have an
				agent&apos;s changes arrive as a proposal instead of being kept straight away.
			</p>
			<Ul>
				<li>A bar over the timeline says the agent proposes changes, with how many clips were added, changed and removed.</li>
				<li>Added clips are outlined green and changed clips amber. Removed clips stay visible as dashed outlines.</li>
				<li>
					Hover a clip to keep or undo that one change (for a removed clip: keep it removed, or bring it back), or use{" "}
					<strong className="text-white">Keep all</strong> and <strong className="text-white">Undo all</strong>.
				</li>
			</Ul>
			<p>Agents cannot accept their own proposals. They are told to summarise what they changed and leave the decision to you.</p>

			<H2 id="limits">What agents can and cannot do</H2>
			<H3>They can</H3>
			<Ul>
				<li>
					Do anything the editor does: every tool is listed in the <A href="/docs/tools">tool reference</A>.
				</li>
				<li>
					Look at the result: <C>render_frame</C> renders exactly what the viewer shows at a moment, so the agent can check a
					title or framing.
				</li>
				<li>Point things out: select clips, move the playhead, set in and out, add markers and switch workspace.</li>
				<li>
					Read the history of the project, including your edits from earlier sessions, and go back to any step.
				</li>
				<li>Export video, audio, stills, captions, stems, variants and timelines for other editors.</li>
			</Ul>
			<H3>They cannot</H3>
			<Ul>
				<li>Change API keys or whether agents are allowed in; those are yours to set.</li>
				<li>Accept their own proposed edits in review mode.</li>
				<li>Edit locked tracks (unless they unlock them, which they are told to do only when you ask).</li>
				<li>
					Overwrite files outside the project&apos;s export folder. They can create new files elsewhere, with the right file
					type.
				</li>
				<li>From the Agent panel: run shell commands, read your files or use the web.</li>
			</Ul>
			<Note>
				Recording a voiceover take uses your microphone, so agents are told to say which line is about to roll before they
				record.
			</Note>

			<H2 id="prompts">Example prompts</H2>
			<Ul>
				{PROMPTS.map((p) => (
					<li key={p}>&quot;{p}&quot;</li>
				))}
			</Ul>

			<H2 id="models">Local and cloud models</H2>
			<p>
				The agent is separate from the models Cue itself uses for voices, transcription, writing and images. Choose those per
				task in <strong className="text-white">Settings → AI &amp; models</strong>:
			</p>
			<Table
				head={["Task", "On your Mac", "Cloud"]}
				rows={[
					["Voices (generated takes)", "macOS voices", "OpenAI text-to-speech"],
					["Transcription (captions, transcripts, script from footage)", "whisper.cpp", "OpenAI"],
					["Writing (rewriting lines, chapters, search by meaning, B-roll ideas)", "Ollama or LM Studio", "OpenAI"],
					["Images (title cards, stills, B-roll)", "None", "OpenAI"],
				]}
			/>
			<Ol>
				<li>
					For local transcription, install whisper.cpp (<C>brew install whisper-cpp</C>) and download a model in Settings. Cue can
					also use the copy that comes with Recordly.
				</li>
				<li>For local writing, run Ollama or LM Studio&apos;s local server and pick a model in Settings.</li>
				<li>For cloud models, paste an OpenAI API key. It is stored encrypted in your macOS keychain.</li>
			</Ol>
			<p>
				Your footage never leaves your Mac unless you choose a cloud model. Editing itself needs no model at all. Agents can
				check what is set up with <C>get_ai_status</C> and tell you when a provider is missing.
			</p>
		</DocPage>
	);
}
