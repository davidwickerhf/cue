import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { doc } from "@/content/docs";
import { SITE_URL } from "@/lib/site";

/** Breadcrumb structured data: Cue → Docs → this page. */
function breadcrumbs(href: string, title: string) {
	const items = [
		{ name: "Cue", item: SITE_URL },
		{ name: "Docs", item: `${SITE_URL}/docs` },
		...(href === "/docs" ? [] : [{ name: title, item: `${SITE_URL}${href}` }]),
	];
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, ...it })),
	};
}

/**
 * A docs page: title, intro and an "on this page" list built from `toc`
 * (each entry is the id of an H2 further down).
 */
export function DocPage({
	href,
	intro,
	toc,
	children,
}: {
	href: string;
	intro: ReactNode;
	toc?: { id: string; label: string }[];
	children: ReactNode;
}) {
	const { title } = doc(href);
	return (
		<article>
			<JsonLd data={breadcrumbs(href, title)} />
			<h1 className="text-[36px] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[44px]">{title}</h1>
			<div className="mt-4 text-[17px] leading-relaxed text-neutral-300">{intro}</div>
			{toc && toc.length > 1 && (
				<nav aria-label="On this page" className="mt-8 rounded-xl border border-line px-4 py-3">
					<p className="text-[12px] font-medium tracking-wide text-[#6f6f6f] uppercase">On this page</p>
					<ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[14px]">
						{toc.map((t) => (
							<li key={t.id}>
								<a href={`#${t.id}`} className="text-muted hover:text-white">
									{t.label}
								</a>
							</li>
						))}
					</ul>
				</nav>
			)}
			<div className="mt-4 flex flex-col gap-4 text-[15px] leading-relaxed text-neutral-300">{children}</div>
		</article>
	);
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
	return (
		<h2 id={id} className="group mt-10 scroll-mt-6 text-[24px] leading-tight font-bold tracking-[-0.025em] text-white">
			<a href={`#${id}`} className="hover:underline hover:decoration-line hover:underline-offset-4">
				{children}
			</a>
		</h2>
	);
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
	return (
		<h3 id={id} className="mt-4 scroll-mt-6 text-[17px] font-semibold text-white">
			{children}
		</h3>
	);
}

export function Ul({ children }: { children: ReactNode }) {
	return <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-[#5f5f5f]">{children}</ul>;
}

export function Ol({ children }: { children: ReactNode }) {
	return <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-[#6f6f6f]">{children}</ol>;
}

/** A key or key combination, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-block min-w-[1.6em] rounded-md border border-line bg-card px-1.5 py-px text-center font-sans text-[13px] whitespace-nowrap text-neutral-200">
			{children}
		</kbd>
	);
}

/** Several keys, e.g. <Keys keys={["J", "K", "L"]} />. */
export function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="inline-flex flex-wrap gap-1">
			{keys.map((k) => (
				<Kbd key={k}>{k}</Kbd>
			))}
		</span>
	);
}

/** Inline code: a tool name, a file name, a value. */
export function C({ children }: { children: ReactNode }) {
	return <code className="rounded-md bg-card px-1.5 py-px font-mono text-[13px] text-neutral-200">{children}</code>;
}

/** A block of code or a command, selectable in one click when it is one line. */
export function CodeBlock({ children }: { children: string }) {
	const oneLine = !children.includes("\n");
	return (
		<pre
			className={`overflow-x-auto rounded-xl border border-line bg-card px-4 py-3 font-mono text-[13px] leading-relaxed text-neutral-200 ${oneLine ? "select-all" : ""}`}
		>
			<code>{children}</code>
		</pre>
	);
}

/** A plain table. The first column is emphasised. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
	return (
		<div className="overflow-x-auto rounded-xl border border-line">
			<table className="w-full border-collapse text-left text-[14px]">
				<thead>
					<tr className="bg-card">
						{head.map((h) => (
							<th key={h} scope="col" className="px-4 py-2.5 font-medium text-white">
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="border-t border-line align-top">
							{row.map((cell, j) => (
								<td key={j} className={`px-4 py-2.5 ${j === 0 ? "text-neutral-200" : "text-muted"}`}>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** A short aside. */
export function Note({ children }: { children: ReactNode }) {
	return <div className="rounded-xl border-l-2 border-accent bg-card px-4 py-3 text-[14px] text-neutral-300">{children}</div>;
}

/** A link inside the docs text. */
export function A({ href, children }: { href: string; children: ReactNode }) {
	const className = "text-white underline decoration-[#5f5f5f] underline-offset-4 hover:decoration-white";
	return href.startsWith("/") ? (
		<Link href={href} className={className}>
			{children}
		</Link>
	) : (
		<a href={href} className={className}>
			{children}
		</a>
	);
}
