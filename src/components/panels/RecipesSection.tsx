import { Button } from "@heroui/react";
import { ArrowRight, Play, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Recipe } from "../../../electron/core/recipes";
import { notify, run } from "../../lib/api";
import { agentDraft } from "../../lib/chat";
import { editor } from "../../lib/state";
import { styleSelection } from "../../lib/styleLibrary";
import { Section } from "../ui/controls";

interface RunResult {
	ok: boolean;
	rolledBack?: boolean;
	done: { skipped?: string }[];
	failed?: { step: number; error: string };
}

const categories = [
	"All",
	"Typography",
	"Montage",
	"Transitions",
	"Compositing",
	"Screen recording",
	"Layouts",
	"Editorial",
];

/** Quick recipes run as fixed calls; style guides give the agent an adaptable brief. */
export function RecipesSection({ busy }: { busy: boolean }) {
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [running, setRunning] = useState<string | null>(null);
	const [category, setCategory] = useState("All");
	const [query, setQuery] = useState("");
	const selectedStyle = styleSelection.use((s) => s.id);
	const load = () => void run<Recipe[]>("list_recipes").then((list) => list && setRecipes(list));
	useEffect(load, []);
	useEffect(() => {
		if (!selectedStyle || !recipes.some((r) => r.id === selectedStyle)) return;
		setCategory("All");
		setQuery("");
		requestAnimationFrame(() => {
			const item = document.getElementById(`style-card-${selectedStyle}`);
			const details = item?.querySelector("details");
			if (details) details.open = true;
			item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	}, [selectedStyle, recipes]);
	const start = async (recipe: Recipe) => {
		setRunning(recipe.id);
		const result = await run<RunResult>("run_recipe", { id: recipe.id });
		setRunning(null);
		if (!result) return;
		if (result.ok) {
			const skipped = result.done.filter((d) => d.skipped).length;
			notify(`${recipe.name}: done${skipped ? ` (${skipped} steps skipped)` : ""}`, "success");
		} else if (result.failed)
			notify(
				`${recipe.name} stopped at step ${result.failed.step}${result.rolledBack ? " and reverted its edits" : ""}: ${result.failed.error}`,
				"danger",
			);
	};
	const ask = (r: Recipe) => {
		agentDraft.set({
			text: `Follow the Cue style guide "${r.name}" (${r.id}) on this project. Call list_recipes to read its full guide, check the available footage, adapt the structure to it, and review the result before finishing.`,
		});
		editor.set({ panel: "agent" });
	};
	const styles = recipes.filter((r) => r.format === "style" || !!r.guide);
	const quick = recipes.filter((r) => r.steps.length > 0 && r.format !== "style");
	const visible = styles.filter(
		(r) =>
			(category === "All" || r.category === category) &&
			`${r.name} ${r.description} ${r.category ?? ""}`.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<>
			<Section title="Style library">
				<p className="text-[12px] leading-relaxed text-muted">
					Editing ideas your agent can adapt to your footage. Open one to see the structure.
				</p>
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search styles"
					aria-label="Search styles"
					className="h-8 w-full rounded-md border border-border bg-field px-2.5 text-[12px] outline-none focus:border-accent"
				/>
				<fieldset className="flex min-w-0 gap-1 overflow-x-auto border-0 pb-1">
					<legend className="sr-only">Style categories</legend>
					{categories.map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => setCategory(c)}
							aria-pressed={category === c}
							className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${category === c ? "bg-accent text-white" : "bg-default text-muted hover:text-foreground"}`}
						>
							{c}
						</button>
					))}
				</fieldset>
				{visible.length === 0 && (
					<p className="text-[12px] text-muted">No styles match that search.</p>
				)}
				<ul className="flex flex-col gap-2">
					{visible.map((r) => (
						<li
							key={r.id}
							id={`style-card-${r.id}`}
							className="overflow-hidden rounded-lg border border-border bg-default/35"
						>
							<details className="group">
								<summary className="flex cursor-pointer items-center gap-3 p-2.5 focus-visible:outline-2 focus-visible:outline-accent">
									<StyleThumb id={r.id} />
									<span className="min-w-0 flex-1">
										<span className="block text-[12px] font-semibold">{r.name}</span>
										<span className="block text-[11px] text-muted">{r.category}</span>
									</span>
									<ArrowRight className="size-3 shrink-0 text-muted transition-transform group-open:rotate-90" />
								</summary>
								<div className="border-t border-border px-3 pb-3 text-[11px] leading-relaxed">
									<p className="mt-2 text-muted">{r.description}</p>
									{r.guide && (
										<>
											<p className="mt-2 font-medium text-foreground">{r.guide.goal}</p>
											<GuideList title="You need" items={r.guide.requires} />
											<GuideList title="Structure" items={r.guide.structure} ordered />
											<GuideList title="Direction" items={r.guide.directions} />
											<GuideList title="Check" items={r.guide.review} />
										</>
									)}
									<button
										type="button"
										onClick={() => ask(r)}
										className="mt-3 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 font-semibold text-white hover:brightness-110"
									>
										Ask agent to make this <ArrowRight className="size-3" />
									</button>
									{!r.builtIn && (
										<button
											type="button"
											onClick={async () => {
												if (await run("delete_recipe", { id: r.id })) load();
											}}
											className="ml-3 inline-flex items-center gap-1 text-muted hover:text-danger"
										>
											<Trash className="size-3" />
											Delete
										</button>
									)}
								</div>
							</details>
						</li>
					))}
				</ul>
			</Section>
			<Section title="Quick recipes">
				<p className="text-[12px] leading-relaxed text-muted">
					Repeatable edits you can run in one click.
				</p>
				<ul className="flex flex-col gap-2">
					{quick.map((r) => (
						<li key={r.id} className="flex items-start gap-2">
							<div className="min-w-0 flex-1">
								<p className="text-[12px] font-medium">{r.name}</p>
								<p className="text-[11px] leading-snug text-muted">
									{r.description || r.steps.map((s) => s.label ?? s.tool).join(" → ")}
								</p>
							</div>
							{!r.builtIn && (
								<button
									type="button"
									aria-label={`Delete ${r.name}`}
									onClick={async () => {
										if (await run("delete_recipe", { id: r.id })) load();
									}}
									className="mt-1 text-muted hover:text-danger"
								>
									<Trash className="size-3.5" />
								</button>
							)}
							<Button
								size="sm"
								variant="secondary"
								className="h-7 shrink-0 gap-1 px-2 text-[11px]"
								isDisabled={busy || running !== null}
								onPress={() => void start(r)}
							>
								<Play weight="fill" className="size-3" />
								{running === r.id ? "Running…" : "Run"}
							</Button>
						</li>
					))}
				</ul>
			</Section>
		</>
	);
}

function GuideList({
	title,
	items,
	ordered = false,
}: {
	title: string;
	items: string[];
	ordered?: boolean;
}) {
	return (
		<div className="mt-2">
			<p className="font-semibold text-foreground">{title}</p>
			{ordered ? (
				<ol className="list-decimal pl-4 text-muted">
					{items.map((s) => (
						<li key={s}>{s}</li>
					))}
				</ol>
			) : (
				<ul className="list-disc pl-4 text-muted">
					{items.map((s) => (
						<li key={s}>{s}</li>
					))}
				</ul>
			)}
		</div>
	);
}

function StyleThumb({ id }: { id: string }) {
	const visual: Record<string, { bg: string; text: string; mark: string }> = {
		"style-kinetic-quote": { bg: "#d9c9aa", text: "SAY IT", mark: "✳" },
		"style-beat-grid": { bg: "#322a57", text: "◼ ◼ ◼", mark: "▰" },
		"style-match-motion": { bg: "#c55134", text: "→ →", mark: "→" },
		"style-paper-collage": { bg: "#d8d1bf", text: "CUT / PASTE", mark: "▧" },
		"style-light-leak": { bg: "#803b24", text: "LIGHT", mark: "✺" },
		"style-screen-focus": { bg: "#31495b", text: "FOCUS", mark: "⌕" },
		"style-split-reveal": { bg: "#455e4b", text: "A / B", mark: "▥" },
		"style-quiet-portrait": { bg: "#535765", text: "STILL", mark: "●" },
	};
	const v = visual[id] ?? { bg: "#454545", text: "STYLE", mark: "•" };
	return (
		<span
			aria-hidden="true"
			className="relative flex h-12 w-16 shrink-0 items-end overflow-hidden rounded-md p-1.5"
			style={{ background: v.bg }}
		>
			<span className="absolute -right-1 -top-4 text-[44px] font-black text-white/25">
				{v.mark}
			</span>
			<span className="relative text-[9px] font-black tracking-tight text-white">{v.text}</span>
		</span>
	);
}
