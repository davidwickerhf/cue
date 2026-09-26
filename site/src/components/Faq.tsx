"use client";

import { Plus } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { Reveal } from "./Reveal";

/** FAQ items that open and close with a smooth height animation. */
export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
	const [open, setOpen] = useState<number | null>(null);
	return (
		<div className="flex flex-col gap-3">
			{items.map((f, i) => {
				const isOpen = open === i;
				return (
					<Reveal key={f.q} delay={i * 80} y={16}>
						<div className="rounded-xl bg-card transition-colors hover:bg-[#1a1a1a]">
							<button
								type="button"
								aria-expanded={isOpen}
								onClick={() => setOpen(isOpen ? null : i)}
								className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-[15px] font-medium"
							>
								{f.q}
								<Plus
									size={16}
									className="shrink-0 text-muted transition-transform duration-300"
									style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
								/>
							</button>
							<div
								className="grid transition-[grid-template-rows] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]"
								style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
							>
								<div className="overflow-hidden">
									<p
										className="px-4 pb-4 text-[14px] leading-relaxed text-muted transition-opacity duration-300"
										style={{ opacity: isOpen ? 1 : 0 }}
									>
										{f.a}
									</p>
								</div>
							</div>
						</div>
					</Reveal>
				);
			})}
		</div>
	);
}
