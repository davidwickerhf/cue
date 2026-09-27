"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

/** A block of text (a prompt, a command) with a button that copies it. */
export function CopyBlock({ text, label = "Copy" }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="relative rounded-2xl border border-line bg-[#0c0c0c]">
			<button
				type="button"
				onClick={() => {
					void navigator.clipboard.writeText(text).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1800);
					});
				}}
				className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-[13px] font-medium text-neutral-200 transition hover:bg-[#222] hover:text-white"
			>
				{copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
				{copied ? "Copied" : label}
			</button>
			<pre className="max-h-[440px] overflow-auto p-5 pr-28 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-300">
				{text}
			</pre>
		</div>
	);
}
