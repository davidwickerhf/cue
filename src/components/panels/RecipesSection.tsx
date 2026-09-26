import { Button } from "@heroui/react";
import { Play, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Recipe } from "../../../electron/core/recipes";
import { notify, run } from "../../lib/api";
import { Section } from "../ui/controls";

interface RunResult {
	ok: boolean;
	done: { label: string; skipped?: string }[];
	failed?: { step: number; label: string; error: string };
}

/** Reusable edits: built-in ones and those saved by you or an agent (save_recipe). */
export function RecipesSection({ busy }: { busy: boolean }) {
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [running, setRunning] = useState<string | null>(null);

	const load = () => void run<Recipe[]>("list_recipes").then((list) => list && setRecipes(list));
	useEffect(load, []);

	const start = async (recipe: Recipe) => {
		setRunning(recipe.id);
		const result = await run<RunResult>("run_recipe", { id: recipe.id });
		setRunning(null);
		if (!result) return;
		if (result.ok) {
			const skipped = result.done.filter((d) => d.skipped).length;
			notify(
				`${recipe.name}: done${skipped ? ` (${skipped} step${skipped === 1 ? "" : "s"} skipped)` : ""}`,
				"success",
			);
		} else if (result.failed)
			notify(
				`${recipe.name} stopped at step ${result.failed.step} (${result.failed.label}): ${result.failed.error}`,
				"danger",
			);
	};

	return (
		<Section title="Recipes">
			<p className="text-[12px] leading-relaxed text-muted">
				Edits you can repeat in one click. Agents can save what they did as a recipe.
			</p>
			<ul className="flex flex-col gap-1.5">
				{recipes.map((r) => (
					<li key={r.id} className="group flex items-start gap-2">
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
								className="mt-1 hidden text-muted group-hover:block hover:text-danger"
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
	);
}
