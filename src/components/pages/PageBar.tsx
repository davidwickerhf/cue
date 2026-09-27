import {
	ChatCircleText,
	Microphone,
	Palette,
	PaperPlaneTilt,
	Robot,
	Scissors,
	ShootingStar,
	SpeakerHigh,
	TextT,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { goToPage, PAGES, type PageId, pageState } from "../../lib/pages";
import { keyLabel } from "../../lib/platform";
import { cn } from "../../lib/utils";

const ICONS: Record<PageId, ReactNode> = {
	edit: <Scissors className="size-4" />,
	motion: <ShootingStar className="size-4" />,
	titles: <TextT className="size-4" />,
	colour: <Palette className="size-4" />,
	audio: <SpeakerHigh className="size-4" />,
	voice: <Microphone className="size-4" />,
	review: <ChatCircleText className="size-4" />,
	deliver: <PaperPlaneTilt className="size-4" />,
	agent: <Robot className="size-4" />,
};

/** The pages along the bottom of the window, one for each job (⌥1–⌥9). */
export function PageBar() {
	const page = pageState.use((s) => s.page);
	return (
		<nav
			aria-label="Pages"
			className="flex h-10 shrink-0 items-center justify-center gap-1 border-t border-separator bg-surface px-2"
		>
			{PAGES.map((p) => (
				<button
					key={p.id}
					type="button"
					onClick={() => goToPage(p.id)}
					aria-current={page === p.id ? "page" : undefined}
					title={`${p.about} (${keyLabel(p.keys)})`}
					className={cn(
						"flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors",
						page === p.id
							? "bg-default font-medium text-foreground"
							: "text-muted hover:bg-default/60 hover:text-foreground",
						p.id === "agent" && "ml-3",
					)}
				>
					<span className={page === p.id ? "text-accent" : undefined}>{ICONS[p.id]}</span>
					{p.label}
				</button>
			))}
		</nav>
	);
}
