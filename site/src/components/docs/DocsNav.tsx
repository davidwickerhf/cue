"use client";

import { CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS, DOCS_GROUPS } from "@/content/docs";

function Links({ current }: { current: string }) {
	return (
		<div className="flex flex-col gap-6">
			{DOCS_GROUPS.map((g) => (
				<div key={g.title}>
					<p className="px-3 text-[12px] font-medium tracking-wide text-[#6f6f6f] uppercase">{g.title}</p>
					<ul className="mt-2 flex flex-col gap-0.5">
						{g.pages.map((p) => {
							const active = p.href === current;
							return (
								<li key={p.href}>
									<Link
										href={p.href}
										aria-current={active ? "page" : undefined}
										className={`block rounded-lg px-3 py-1.5 text-[14px] transition-colors ${
											active ? "bg-card font-medium text-white" : "text-muted hover:text-white"
										}`}
									>
										{p.title}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}

/**
 * The docs sidebar: sticky beside the page on wide screens, a collapsible menu
 * above it on phones (closed again after every navigation).
 */
export function DocsNav() {
	const current = usePathname();
	const page = DOCS.find((d) => d.href === current);
	return (
		<>
			<details key={current} className="group rounded-xl bg-card lg:hidden">
				<summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[14px]">
					<span>
						<span className="text-muted">Docs · </span>
						{page?.title ?? "Menu"}
					</span>
					<CaretDown size={16} className="text-muted transition-transform group-open:rotate-180" />
				</summary>
				<nav aria-label="Docs" className="border-t border-line px-1 py-4">
					<Links current={current} />
				</nav>
			</details>
			<aside className="hidden w-[220px] shrink-0 lg:block">
				<nav aria-label="Docs" data-lenis-prevent className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
					<Links current={current} />
				</nav>
			</aside>
		</>
	);
}

/** Previous and next page links at the foot of a docs page. */
export function DocsPager() {
	const current = usePathname();
	const i = DOCS.findIndex((d) => d.href === current);
	if (i < 0) return null;
	const prev = DOCS[i - 1];
	const next = DOCS[i + 1];
	return (
		<nav aria-label="More docs" className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
			{prev ? (
				<Link href={prev.href} className="rounded-xl bg-card px-4 py-3 hover:bg-[#1a1a1a]">
					<span className="flex items-center gap-1 text-[12px] text-muted">
						<CaretLeft size={12} /> Previous
					</span>
					<span className="mt-0.5 block text-[15px] font-medium">{prev.title}</span>
				</Link>
			) : (
				<span />
			)}
			{next && (
				<Link href={next.href} className="rounded-xl bg-card px-4 py-3 text-right hover:bg-[#1a1a1a]">
					<span className="flex items-center justify-end gap-1 text-[12px] text-muted">
						Next <CaretRight size={12} />
					</span>
					<span className="mt-0.5 block text-[15px] font-medium">{next.title}</span>
				</Link>
			)}
		</nav>
	);
}
