import { Button, Spinner } from "@heroui/react";
import {
	ArrowClockwise,
	CaretRight,
	CheckCircle,
	Cpu,
	Info,
	Keyboard,
	Robot,
	SlidersHorizontal,
	Sparkle,
	Warning,
	X,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { notify } from "../../lib/api";
import { isMac, keyLabel, thisComputer } from "../../lib/platform";
import { SHORTCUTS } from "../../lib/shortcuts";
import { appSettings, useApp } from "../../lib/state";
import { cn } from "../../lib/utils";
import { AgentConnect } from "../AgentConnect";
import { Segmented, Toggle } from "../ui/controls";

type Inventory = Awaited<ReturnType<typeof window.cue.localInventory>>;
type UpdateStatus = Awaited<ReturnType<typeof window.cue.updateStatus>>;
type Settings = NonNullable<ReturnType<typeof appSettings.get>["settings"]>;

const SECTIONS = [
	{ id: "general", label: "General", icon: SlidersHorizontal },
	{ id: "ai", label: "AI & models", icon: Sparkle },
	{ id: "agent", label: "Agent", icon: Robot },
	{ id: "shortcuts", label: "Shortcuts", icon: Keyboard },
	{ id: "about", label: "About", icon: Info },
] as const;

/** App-wide settings (⌘,), separate from per-project settings. */
export function SettingsView() {
	const { open, section, settings } = appSettings.use((s) => s);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && appSettings.set({ open: false });
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open || !settings) return null;
	const save = (patch: Partial<Settings>) => void window.cue.setAppSettings(patch);
	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={() => appSettings.set({ open: false })}
		>
			<div
				className="m-auto flex h-[min(760px,90vh)] w-[min(980px,92vw)] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
				onPointerDown={(e) => e.stopPropagation()}
				role="dialog"
				aria-label="Settings"
			>
				<nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-separator bg-background/40 p-2">
					<p className="px-2.5 pt-2 pb-3 text-[13px] font-semibold">Settings</p>
					{SECTIONS.map((s) => (
						<button
							key={s.id}
							type="button"
							onClick={() => appSettings.set({ section: s.id })}
							className={cn(
								"flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[13px]",
								section === s.id
									? "bg-default text-foreground"
									: "text-muted hover:bg-default/60 hover:text-foreground",
							)}
						>
							<s.icon className="size-4" />
							{s.label}
						</button>
					))}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-6">
						<h2 className="text-[14px] font-semibold">
							{SECTIONS.find((s) => s.id === section)?.label}
						</h2>
						<button
							type="button"
							aria-label="Close"
							onClick={() => appSettings.set({ open: false })}
							className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
						>
							<X className="size-4" />
						</button>
					</header>
					<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
						{section === "general" && <General settings={settings} save={save} />}
						{section === "ai" && <AiSection settings={settings} save={save} />}
						{section === "agent" && <AgentSection settings={settings} save={save} />}
						{section === "shortcuts" && <Shortcuts />}
						{section === "about" && <About />}
					</div>
				</div>
			</div>
		</div>
	);
}

function Group({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="mb-7">
			<h3 className="text-[13px] font-semibold">{title}</h3>
			{description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
			<div className="mt-3 divide-y divide-separator rounded-lg border border-border bg-background/30">
				{children}
			</div>
		</section>
	);
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="flex min-h-12 items-center justify-between gap-6 px-4 py-2.5">
			<div className="min-w-0">
				<p className="text-[13px]">{label}</p>
				{hint && <p className="text-[11px] text-muted">{keyLabel(hint)}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</div>
	);
}

function General({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => void }) {
	return (
		<>
			<Group title="Appearance">
				<Row label="Theme">
					<Segmented
						size="xs"
						value={settings.theme}
						onChange={(theme) => save({ theme })}
						options={[
							{ value: "dark", label: "Dark" },
							{ value: "light", label: "Light" },
							{ value: "system", label: "System" },
						]}
					/>
				</Row>
				<Row
					label="Sidebar"
					hint={
						settings.sidebar === "full"
							? "Down the whole window: the timeline starts beside it."
							: "Beside the viewer: the timeline spans the whole window."
					}
				>
					<Segmented
						size="xs"
						value={settings.sidebar}
						onChange={(sidebar) => save({ sidebar })}
						options={[
							{ value: "viewer", label: "Beside the viewer" },
							{ value: "full", label: "Full height" },
						]}
					/>
				</Row>
			</Group>
			<Group title="Projects">
				<Row label="Projects folder" hint={settings.projectsDir.replace(/^\/Users\/[^/]+/, "~")}>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 text-[12px]"
						onPress={async () => {
							const dir = await window.cue.chooseFolder({
								title: "Projects folder",
								defaultPath: settings.projectsDir,
							});
							if (dir) save({ projectsDir: dir });
						}}
					>
						Change…
					</Button>
				</Row>
				<Row
					label="Reopen the last project on launch"
					hint="Otherwise Cue starts in the projects overview"
				>
					<Toggle
						label=""
						checked={settings.reopenLast}
						onChange={(reopenLast) => save({ reopenLast })}
					/>
				</Row>
			</Group>
			<Group
				title="Editing"
				description="Defaults for new sessions. Conventions follow Premiere Pro, DaVinci Resolve and Final Cut Pro."
			>
				<Row label="Snapping on by default">
					<Toggle
						label=""
						checked={settings.editor.snapping}
						onChange={(snapping) => save({ editor: { ...settings.editor, snapping } })}
					/>
				</Row>
				<Row label="Delete closes gaps (ripple) by default" hint="⇧⌫ always ripple-deletes">
					<Toggle
						label=""
						checked={settings.editor.rippleByDefault}
						onChange={(rippleByDefault) =>
							save({ editor: { ...settings.editor, rippleByDefault } })
						}
					/>
				</Row>
				<Row
					label="Playback copies of large videos"
					hint="Smoother playback and scrubbing. Exports always use the originals."
				>
					<Toggle
						label=""
						checked={settings.editor.autoProxies}
						onChange={(autoProxies) => save({ editor: { ...settings.editor, autoProxies } })}
					/>
				</Row>
			</Group>
			<Updates settings={settings} save={save} />
		</>
	);
}

/** Settings → General → Updates: checks, download consent and install preference. */
function Updates({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => void }) {
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		void window.cue.updateStatus().then(setStatus);
		return window.cue.onUpdateStatus(setStatus);
	}, []);
	const hint =
		status?.state === "unsupported"
			? status.message
			: status?.state === "ready"
				? `Cue ${status.version} is downloaded. ${status.installOnQuit ? "It will install when Cue quits, or you can restart now." : "Restart when you're ready to install it."}`
				: status?.state === "available"
					? `Cue ${status.version} is available. Choose Download to get it.`
					: status?.state === "downloading"
						? `Downloading Cue ${status.version}… ${status.percent ?? 0}%`
						: status?.state === "checking"
							? "Checking…"
							: status?.state === "error"
								? `The last check failed: ${status.message}`
								: status?.checkedAt
									? `Up to date. Checked ${new Date(status.checkedAt).toLocaleString()}.`
									: "Checks GitHub at launch and every few hours. With automatic installation off, each download needs your approval.";
	return (
		<Group title="Updates">
			<Row label="Check for updates automatically" hint={hint}>
				{status?.state === "ready" ? (
					<Button
						size="sm"
						className="h-7 text-[12px]"
						onPress={() => void window.cue.installUpdate()}
					>
						Restart to update
					</Button>
				) : status?.state === "available" ? (
					<Button
						size="sm"
						className="h-7 text-[12px]"
						isDisabled={busy}
						onPress={async () => {
							setBusy(true);
							const next = await window.cue.downloadUpdate().finally(() => setBusy(false));
							if (next) setStatus(next);
						}}
					>
						Download Cue {status.version}
					</Button>
				) : (
					<Button
						size="sm"
						variant="secondary"
						className="h-7 text-[12px]"
						isDisabled={
							busy ||
							status?.state === "unsupported" ||
							status?.state === "downloading" ||
							status?.state === "checking"
						}
						onPress={async () => {
							setBusy(true);
							const next = await window.cue.checkForUpdates().finally(() => setBusy(false));
							if (next) setStatus(next);
						}}
					>
						Check now
					</Button>
				)}
				<Toggle
					label=""
					checked={settings.autoUpdate}
					onChange={(autoUpdate) => save({ autoUpdate })}
				/>
			</Row>
			<Row
				label="Download and install updates automatically"
				hint="Turning this on checks for new versions, downloads them, and installs them when Cue quits. Changes after a download starts apply to later updates."
			>
				<Toggle
					label=""
					checked={settings.autoInstallUpdates}
					onChange={(autoInstallUpdates) => save({ autoInstallUpdates })}
				/>
			</Row>
		</Group>
	);
}

function StatusPill({ ready, text }: { ready: boolean; text: string }) {
	return (
		<span
			className={cn("flex items-center gap-1 text-[11px]", ready ? "text-success" : "text-warning")}
		>
			{ready ? (
				<CheckCircle weight="fill" className="size-3.5" />
			) : (
				<Warning weight="fill" className="size-3.5" />
			)}
			{text}
		</span>
	);
}

/** Which provider a task will use, or why none can. */
function RouteStatus({
	status,
}: {
	status?: { ready: boolean; provider: string; problem?: string };
}) {
	if (!status) return null;
	return (
		<StatusPill
			ready={status.ready}
			text={status.ready ? status.provider : (status.problem ?? "")}
		/>
	);
}

function AiSection({
	settings,
	save,
}: {
	settings: Settings;
	save: (p: Partial<Settings>) => void;
}) {
	const status = useApp((s) => s.ai.status) ?? [];
	const [inv, setInv] = useState<Inventory | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [progress, setProgress] = useState<Record<string, number>>({});
	const refresh = useCallback(
		async (force = false) => setInv(await window.cue.localInventory(force)),
		[],
	);
	useEffect(() => {
		void refresh(true);
		return window.cue.onDownloadProgress((name, fraction) =>
			setProgress((p) => ({ ...p, [name]: fraction })),
		);
	}, [refresh]);
	const ai = settings.ai;
	const set = (patch: Partial<Settings["ai"]>) => save({ ai: { ...ai, ...patch } });
	const st = (c: string) => status.find((s) => s.capability === c);
	const local = inv?.inventory;

	return (
		<>
			<Connections />

			<Group
				title="Providers"
				description={`Which service does each task: the cloud (from your connections) or models on ${thisComputer}. Auto picks from what's connected.`}
			>
				<Row label="Voices" hint="Generated takes for script lines">
					<RouteStatus status={st("tts")} />
					<Segmented
						size="xs"
						value={ai.tts}
						onChange={(tts) => set({ tts })}
						options={[
							{ value: "auto", label: "Auto" },
							{ value: "openai", label: "OpenAI" },
							{ value: "elevenlabs", label: "ElevenLabs" },
							// The system voices are macOS's; elsewhere only a saved choice shows.
							...(isMac || ai.tts === "macos"
								? [{ value: "macos" as const, label: "On this Mac" }]
								: []),
						]}
					/>
				</Row>
				<Row label="Transcription" hint="Captions, transcripts, script from footage">
					<StatusPill
						ready={!!st("transcription")?.ready}
						text={st("transcription")?.ready ? "Ready" : (st("transcription")?.problem ?? "")}
					/>
					<Segmented
						size="xs"
						value={ai.transcription}
						onChange={(transcription) => set({ transcription })}
						options={[
							{ value: "openai", label: "OpenAI" },
							{ value: "whisper", label: "whisper.cpp" },
						]}
					/>
				</Row>
				<Row label="Text" hint="Rewriting lines to fit, suggestions">
					<StatusPill
						ready={!!st("text")?.ready}
						text={st("text")?.ready ? (st("text")?.model ?? "Ready") : (st("text")?.problem ?? "")}
					/>
					<Segmented
						size="xs"
						value={ai.text}
						onChange={(text) => set({ text, textModel: undefined })}
						options={[
							{ value: "openai", label: "OpenAI" },
							{ value: "ollama", label: "Ollama" },
							{ value: "lmstudio", label: "LM Studio" },
							{ value: "none", label: "Off" },
						]}
					/>
				</Row>
				<Row label="Images" hint="Title cards and stills">
					<RouteStatus status={st("image")} />
					<Segmented
						size="xs"
						value={ai.image}
						onChange={(image) => set({ image })}
						options={[
							{ value: "auto", label: "Auto" },
							{ value: "openai", label: "OpenAI" },
							{ value: "fal", label: "fal" },
							{ value: "none", label: "Off" },
						]}
					/>
				</Row>
				<Row label="Sound effects and music" hint="ElevenLabs: your key if connected, else via fal">
					<RouteStatus status={st("sound")} />
				</Row>
				<Row label="Video clips" hint="Kling and Hailuo: via fal, or Higgsfield">
					<RouteStatus status={st("video")} />
				</Row>
			</Group>

			<Group
				title={isMac ? "On this Mac" : "On this computer"}
				description="Found automatically. Nothing leaves your computer when these are used."
			>
				<Row label="Scan again">
					<Button
						size="sm"
						variant="ghost"
						className="h-7 gap-1.5 text-[12px]"
						onPress={() => void refresh(true)}
					>
						<ArrowClockwise className="size-3.5" /> Refresh
					</Button>
				</Row>
				{isMac && (
					<Row
						label="macOS voices"
						hint={
							local
								? `${local.macVoices.length} installed. Add more in System Settings → Accessibility → Spoken Content.`
								: "…"
						}
					>
						<select
							value={ai.macVoice}
							onChange={(e) => set({ macVoice: e.target.value })}
							className="h-7 max-w-56 rounded-md border border-border bg-field px-2 text-[12px] outline-none"
						>
							{(local?.macVoices ?? [])
								.filter((v) => v.locale.startsWith("en"))
								.concat((local?.macVoices ?? []).filter((v) => !v.locale.startsWith("en")))
								.map((v) => (
									<option key={v.name} value={v.name}>
										{v.name} · {v.locale}
									</option>
								))}
						</select>
						<Button
							size="sm"
							variant="secondary"
							className="h-7 text-[12px]"
							onPress={() => void window.cue.previewVoice(ai.macVoice)}
						>
							Listen
						</Button>
					</Row>
				)}
				<Row
					label="whisper.cpp"
					hint={
						local?.whisper.binary
							? `${local.whisper.binary.includes("Recordly") ? "Using Recordly's copy" : local.whisper.binary}`
							: isMac
								? "Not found. Install with: brew install whisper-cpp"
								: "Not found. Build or install whisper.cpp and put whisper-cli on your PATH"
					}
				>
					{local?.whisper.models.length ? (
						<select
							value={ai.whisperModel ?? local.whisper.models[0].path}
							onChange={(e) => set({ whisperModel: e.target.value })}
							className="h-7 max-w-56 rounded-md border border-border bg-field px-2 text-[12px] outline-none"
						>
							{local.whisper.models.map((m) => (
								<option key={m.path} value={m.path}>
									{m.name} · {m.sizeMb} MB
								</option>
							))}
						</select>
					) : (
						<span className="text-[11px] text-muted">No model yet</span>
					)}
				</Row>
				{local?.whisper.binary &&
					Object.entries(inv?.downloads ?? {})
						.filter(([name]) => !local.whisper.models.some((m) => m.name === name))
						.map(([name, spec]) => (
							<Row
								key={name}
								label={`Download ${name.replace("ggml-", "").replace(".bin", "")}`}
								hint={`${spec.sizeMb} MB${name.includes(".en") ? " · English only, fastest" : name.includes("turbo") ? " · most accurate" : " · multilingual"}`}
							>
								{busy === name ? (
									<span className="flex items-center gap-2 text-[11px] text-muted">
										<Spinner size="sm" /> {Math.round((progress[name] ?? 0) * 100)}%
									</span>
								) : (
									<Button
										size="sm"
										variant="secondary"
										className="h-7 text-[12px]"
										onPress={async () => {
											setBusy(name);
											try {
												await window.cue.downloadWhisper(name);
												notify("Model ready. Transcription now runs on this Mac.", "success");
											} catch (error) {
												notify((error as Error).message, "danger");
											} finally {
												setBusy(null);
												void refresh(true);
											}
										}}
									>
										Download
									</Button>
								)}
							</Row>
						))}
				<Row
					label="Ollama"
					hint={
						!local
							? "…"
							: !local.ollama.installed
								? "Not installed (ollama.com)"
								: local.ollama.running
									? `${local.ollama.models.length} model(s)`
									: "Installed, not running"
					}
				>
					{local?.ollama.running ? (
						<select
							value={ai.text === "ollama" ? (ai.textModel ?? local.ollama.models[0] ?? "") : ""}
							onChange={(e) => set({ text: "ollama", textModel: e.target.value })}
							className="h-7 max-w-56 rounded-md border border-border bg-field px-2 text-[12px] outline-none"
						>
							{ai.text !== "ollama" && <option value="">Use a model…</option>}
							{local.ollama.models.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					) : local?.ollama.installed ? (
						<Button
							size="sm"
							variant="secondary"
							className="h-7 text-[12px]"
							onPress={async () => {
								setBusy("ollama");
								await window.cue.startOllama().catch((e: Error) => notify(e.message, "danger"));
								setBusy(null);
								void refresh(true);
							}}
						>
							{busy === "ollama" ? <Spinner size="sm" /> : "Start"}
						</Button>
					) : null}
				</Row>
				<Row
					label="LM Studio"
					hint={
						local?.lmStudio.running
							? `${local.lmStudio.models.length} model(s) served`
							: "Start its local server to use it"
					}
				>
					{local?.lmStudio.running && (
						<select
							value={ai.text === "lmstudio" ? (ai.textModel ?? local.lmStudio.models[0] ?? "") : ""}
							onChange={(e) => set({ text: "lmstudio", textModel: e.target.value })}
							className="h-7 max-w-56 rounded-md border border-border bg-field px-2 text-[12px] outline-none"
						>
							{ai.text !== "lmstudio" && <option value="">Use a model…</option>}
							{local.lmStudio.models.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					)}
				</Row>
			</Group>
			<p className="flex items-center gap-1.5 text-[11px] text-muted">
				<Cpu className="size-3.5" /> Cue looks for whisper.cpp, Ollama, LM Studio and system voices
				when you open this page.
			</p>
		</>
	);
}

type Service = "fal" | "openai" | "elevenlabs" | "higgsfield";
type ConnectStatus = Awaited<ReturnType<typeof window.cue.connectState>>;

const SERVICES: {
	id: Exclude<Service, "higgsfield">;
	name: string;
	blurb: string;
	recommended?: boolean;
}[] = [
	{
		id: "fal",
		name: "fal",
		blurb: "One key for voice, sound, music, video and images.",
		recommended: true,
	},
	{ id: "openai", name: "OpenAI", blurb: "OpenAI voices and images, transcription, text." },
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		blurb: "Your own and cloned voices, and music, directly.",
	},
];

const keyField =
	"h-7 w-44 rounded-md border border-border bg-field px-2 text-[12px] outline-none focus:border-accent";

/** The Connect flow's state, kept by the main process (it survives closing Settings). */
function useConnectFlow(): ConnectStatus {
	const [flow, setFlow] = useState<ConnectStatus>({ service: null, state: "idle" });
	useEffect(() => {
		void window.cue.connectState().then(setFlow);
		return window.cue.onConnectStatus((next) => {
			setFlow(next);
			if (next.state === "connected" && next.service)
				notify(`${SERVICES.find((s) => s.id === next.service)?.name} connected`, "success");
		});
	}, []);
	return flow;
}

function useConnection(service: Service) {
	return useApp((s) => s.ai.connections?.find((c) => c.service === service));
}

/** Checks a connected key and says how that went. */
async function test(service: Service) {
	const result = await window.cue.testConnection(service);
	notify(result.message, result.ok ? "success" : "danger");
}

/** A key pasted by hand: the main process checks it with the service before storing it. */
function PasteKey({
	service,
	onDone,
}: {
	service: Exclude<Service, "higgsfield">;
	onDone: () => void;
}) {
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<>
			<input
				type="password"
				value={value}
				placeholder="Paste key"
				aria-label={`${service} API key`}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => e.stopPropagation()}
				className={keyField}
			/>
			<Button
				size="sm"
				className="h-7 text-[12px]"
				isDisabled={busy || value.trim().length < 16}
				onPress={async () => {
					setBusy(true);
					const result = await window.cue
						.connectWithKey(service, value)
						.finally(() => setBusy(false));
					notify(result.message, result.ok ? "success" : "danger");
					if (result.ok) {
						setValue("");
						void window.cue.connectCancel();
						onDone();
					}
				}}
			>
				{busy ? <Spinner size="sm" /> : "Save"}
			</Button>
		</>
	);
}

function ServiceRow({
	service,
	flow,
}: {
	service: (typeof SERVICES)[number];
	flow: ConnectStatus;
}) {
	const connection = useConnection(service.id);
	const [pasting, setPasting] = useState(false);
	const [testing, setTesting] = useState(false);
	const pending = flow.service === service.id && flow.state === "pending";
	const timedOut = flow.service === service.id && flow.state === "timeout";
	return (
		<div className="flex flex-col gap-1.5 px-4 py-2.5">
			<div className="flex min-h-7 items-center justify-between gap-6">
				<div className="min-w-0">
					<p className="flex items-center gap-2 text-[13px]">
						{service.name}
						{service.recommended && (
							<span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-medium text-accent">
								Recommended
							</span>
						)}
					</p>
					<p className="text-[11px] text-muted">{service.blurb}</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{connection?.connected ? (
						<>
							<StatusPill
								ready
								text={connection.source === "environment" ? "From your environment" : "Connected"}
							/>
							<Button
								size="sm"
								variant="secondary"
								className="h-7 text-[12px]"
								isDisabled={testing}
								onPress={async () => {
									setTesting(true);
									await test(service.id).finally(() => setTesting(false));
								}}
							>
								{testing ? <Spinner size="sm" /> : "Test"}
							</Button>
							{connection.source !== "environment" && (
								<Button
									size="sm"
									variant="ghost"
									className="h-7 text-[12px] text-danger"
									onPress={() =>
										void window.cue.disconnect(service.id).then(() => notify("Key removed"))
									}
								>
									Remove
								</Button>
							)}
						</>
					) : pending ? (
						<>
							<span className="flex items-center gap-1.5 text-[11px] text-muted">
								<Spinner size="sm" /> Copy your new key — Cue will pick it up
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-[12px]"
								onPress={() => void window.cue.connectCancel()}
							>
								Cancel
							</Button>
						</>
					) : (
						<>
							{!pasting && (
								<button
									type="button"
									className="text-[11px] text-muted hover:text-foreground"
									onClick={() => setPasting(true)}
								>
									Paste key
								</button>
							)}
							<Button
								size="sm"
								className="h-7 text-[12px]"
								onPress={() => void window.cue.connectStart(service.id)}
							>
								Connect
							</Button>
						</>
					)}
				</div>
			</div>
			{!connection?.connected &&
				(pending || timedOut || flow.message) &&
				flow.service === service.id && (
					<p className="text-[11px] text-muted">
						{flow.message ??
							(timedOut
								? "No key turned up. Try Connect again, or paste the key."
								: "Create a key on the page that opened and copy it. Anything else you copy is ignored.")}
					</p>
				)}
			{!connection?.connected && (pasting || pending) && (
				<div className="flex items-center justify-end gap-2">
					<PasteKey service={service.id} onDone={() => setPasting(false)} />
				</div>
			)}
		</div>
	);
}

/** Higgsfield (video; fal covers the same models): a key id and secret typed by hand. */
function HiggsfieldRow() {
	const connection = useConnection("higgsfield");
	const [id, setId] = useState("");
	const [secret, setSecret] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<div className="flex min-h-12 items-center justify-between gap-6 px-4 py-2.5">
			<div className="min-w-0">
				<p className="text-[13px]">Higgsfield</p>
				<p className="text-[11px] text-muted">
					Kling and Hailuo video with a Higgsfield key (id and secret).{" "}
					<a
						href="https://cloud.higgsfield.ai/api-keys"
						target="_blank"
						rel="noreferrer"
						className="text-accent hover:underline"
					>
						Get a key
					</a>
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{connection?.connected ? (
					<>
						<StatusPill ready text="Connected" />
						<Button
							size="sm"
							variant="secondary"
							className="h-7 text-[12px]"
							onPress={() => void test("higgsfield")}
						>
							Test
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-[12px] text-danger"
							onPress={() =>
								void window.cue.disconnect("higgsfield").then(() => notify("Key removed"))
							}
						>
							Remove
						</Button>
					</>
				) : (
					<>
						<input
							type="password"
							value={id}
							placeholder="Key id"
							aria-label="Higgsfield key id"
							onChange={(e) => setId(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							className={cn(keyField, "w-28")}
						/>
						<input
							type="password"
							value={secret}
							placeholder="Key secret"
							aria-label="Higgsfield key secret"
							onChange={(e) => setSecret(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							className={cn(keyField, "w-36")}
						/>
						<Button
							size="sm"
							className="h-7 text-[12px]"
							isDisabled={busy || !id.trim() || secret.trim().length < 8}
							onPress={async () => {
								setBusy(true);
								const result = await window.cue
									.connectWithKey("higgsfield", { id, secret })
									.finally(() => setBusy(false));
								notify(result.message, result.ok ? "success" : "danger");
								if (result.ok) {
									setId("");
									setSecret("");
								}
							}}
						>
							{busy ? <Spinner size="sm" /> : "Connect"}
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

/** Settings → AI → Connections: the services Cue can use, each with the user's own key. */
function Connections() {
	const flow = useConnectFlow();
	const [more, setMore] = useState(false);
	return (
		<section className="mb-7">
			<h3 className="text-[13px] font-semibold">Connections</h3>
			<p className="mt-0.5 text-[12px] text-muted">
				Connect opens the service's key page; create a key and copy it, and Cue picks it up. Keys
				are checked, stored encrypted with your{" "}
				{isMac ? "macOS keychain" : "system's credential store"} and never shown again. Cue only
				calls a service when you or an agent generate with it.
			</p>
			<div className="mt-3 divide-y divide-separator rounded-lg border border-border bg-background/30">
				{SERVICES.map((s) => (
					<ServiceRow key={s.id} service={s} flow={flow} />
				))}
			</div>
			<button
				type="button"
				onClick={() => setMore((m) => !m)}
				className="mt-2 flex items-center gap-1 text-[12px] text-muted hover:text-foreground"
			>
				<CaretRight className={cn("size-3 transition-transform", more && "rotate-90")} /> More
				connections
			</button>
			{more && (
				<div className="mt-2 rounded-lg border border-border bg-background/30">
					<HiggsfieldRow />
				</div>
			)}
		</section>
	);
}

function AgentSection({
	settings,
	save,
}: {
	settings: Settings;
	save: (p: Partial<Settings>) => void;
}) {
	const agent = useApp((s) => s.agent);
	return (
		<>
			<Group title="Access">
				<Row
					label="Allow agents to control Cue"
					hint="Over MCP, on this Mac only, with a token that changes every launch."
				>
					<Toggle
						label=""
						checked={settings.agent.enabled}
						onChange={(enabled) => save({ agent: { ...settings.agent, enabled } })}
					/>
				</Row>
				<Row
					label="Review agent edits"
					hint="An agent's changes are shown on the timeline as a proposal; keep or undo each clip, or all at once."
				>
					<Toggle
						label=""
						checked={settings.agent.review}
						onChange={(review) => save({ agent: { ...settings.agent, review } })}
					/>
				</Row>
				<Row
					label="This session"
					hint={agent?.requests ? `${agent.requests} requests` : "No requests yet"}
				>
					<span
						className={cn(
							"size-2 rounded-full",
							agent?.lastSeenAt ? "bg-success" : "bg-foreground/25",
						)}
					/>
				</Row>
			</Group>
			<Group
				title="Connect an agent"
				description="Claude Code, Codex, Gemini CLI, VS Code, Cursor, Claude Desktop or any MCP client."
			>
				<div className="p-3">
					<AgentConnect />
				</div>
			</Group>
		</>
	);
}

function Shortcuts() {
	return (
		<>
			{SHORTCUTS.map((group) => (
				<Group key={group.title} title={group.title}>
					{group.items.map((item) => (
						<Row key={item.label} label={item.label} hint={item.note}>
							<span className="flex gap-1">
								{item.keys.map((k) => (
									<kbd
										key={k}
										className="rounded-md border border-border bg-default px-1.5 py-0.5 font-sans text-[11px]"
									>
										{keyLabel(k)}
									</kbd>
								))}
							</span>
						</Row>
					))}
				</Group>
			))}
		</>
	);
}

function About() {
	const [info, setInfo] = useState<Awaited<ReturnType<typeof window.cue.appInfo>> | null>(null);
	useEffect(() => {
		void window.cue.appInfo().then(setInfo);
	}, []);
	return (
		<div className="flex flex-col gap-2 text-[13px]">
			<p className="flex items-baseline gap-2">
				<span className="font-semibold">Cue</span>
				{info && (
					<span className="select-text text-muted tabular-nums">
						Version {info.version}
						{info.packaged ? "" : " (development build)"}
					</span>
				)}
			</p>
			<p className="text-muted">
				A fast, AI-centred video editor. Projects are plain files you own; agents work through MCP
				with every change attributed and undoable.
			</p>
			<p className="text-[12px] text-muted">Built with Electron, React, HeroUI and ffmpeg.</p>
			{info && (
				<p className="select-text text-[12px] text-muted tabular-nums">
					Electron {info.electron} · Chromium {info.chrome} · {info.arch}
				</p>
			)}
			<p className="text-[12px]">
				<a
					href="https://cue.wicker.life/changelog"
					target="_blank"
					rel="noreferrer"
					className="text-accent hover:underline"
				>
					What&apos;s new
				</a>
			</p>
		</div>
	);
}
