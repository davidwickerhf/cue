import { Fragment, type ReactNode } from "react";

/**
 * The markdown agents write in replies: paragraphs, headings, bullet and numbered lists
 * (nested by indentation), code blocks, and inline bold, italic, code and links. Built
 * as React elements (never HTML), so a reply can't inject anything into the page.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
	return <div className={className}>{blocks(text.replace(/\r\n/g, "\n"))}</div>;
}

type Item = { depth: number; ordered: boolean; text: string };

function blocks(text: string): ReactNode[] {
	const lines = text.split("\n");
	const out: ReactNode[] = [];
	let para: string[] = [];
	let items: Item[] = [];
	const flushPara = () => {
		if (para.length) out.push(<p key={out.length}>{inline(para.join(" "))}</p>);
		para = [];
	};
	const flushList = () => {
		if (items.length) out.push(<List key={out.length} items={items} />);
		items = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) {
			flushPara();
			flushList();
			const code: string[] = [];
			while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
			out.push(
				<pre
					key={out.length}
					className="overflow-x-auto rounded-md bg-default/60 px-2 py-1.5 font-mono text-[11px]"
				>
					{code.join("\n")}
				</pre>,
			);
			continue;
		}
		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) {
			flushPara();
			flushList();
			out.push(
				<p key={out.length} className="font-semibold">
					{inline(heading[2])}
				</p>,
			);
			continue;
		}
		const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (item) {
			flushPara();
			items.push({
				depth: Math.floor(item[1].replace(/\t/g, "  ").length / 2),
				ordered: /\d/.test(item[2]),
				text: item[3],
			});
			continue;
		}
		if (!line.trim()) {
			flushPara();
			flushList();
			continue;
		}
		// A line indented under a list item continues it.
		if (items.length && /^\s+\S/.test(line)) {
			items[items.length - 1].text += ` ${line.trim()}`;
			continue;
		}
		flushList();
		para.push(line.trim());
	}
	flushPara();
	flushList();
	return out;
}

function List({ items }: { items: Item[] }) {
	// Nest items by depth: each item keeps the items deeper than it that follow it.
	const tree = (from: number, depth: number): [ReactNode, number] => {
		const ordered = items[from]?.ordered;
		const children: ReactNode[] = [];
		let i = from;
		while (i < items.length && items[i].depth >= depth) {
			if (items[i].depth > depth) {
				const [sub, next] = tree(i, items[i].depth);
				children.push(<Fragment key={`s${i}`}>{sub}</Fragment>);
				i = next;
				continue;
			}
			const current = items[i];
			let sub: ReactNode = null;
			let next = i + 1;
			if (next < items.length && items[next].depth > depth)
				[sub, next] = tree(next, items[next].depth);
			children.push(
				<li key={i}>
					{inline(current.text)}
					{sub}
				</li>,
			);
			i = next;
		}
		const Tag = ordered ? "ol" : "ul";
		return [
			<Tag key={`l${from}`} className={ordered ? "list-decimal pl-5" : "list-disc pl-4"}>
				{children}
			</Tag>,
			i,
		];
	};
	return <>{tree(0, items[0]?.depth ?? 0)[0]}</>;
}

/** Bold, italic, inline code and links inside a line. */
export function inline(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	const pattern =
		/(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
	let last = 0;
	for (const m of text.matchAll(pattern)) {
		const at = m.index ?? 0;
		if (at > last) out.push(text.slice(last, at));
		const t = m[0];
		const key = out.length;
		if (m[1])
			out.push(
				<code key={key} className="rounded bg-default/70 px-1 font-mono text-[11px]">
					{t.slice(1, -1)}
				</code>,
			);
		else if (m[2] || m[3])
			out.push(
				<strong key={key} className="font-semibold">
					{inline(t.slice(2, -2))}
				</strong>,
			);
		else if (m[4] || m[5]) out.push(<em key={key}>{inline(t.slice(1, -1))}</em>);
		else {
			const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
			const href = link?.[2] ?? "";
			out.push(
				/^https?:\/\//.test(href) ? (
					<a
						key={key}
						href={href}
						target="_blank"
						rel="noreferrer"
						className="text-accent hover:underline"
					>
						{link?.[1]}
					</a>
				) : (
					link?.[1]
				),
			);
		}
		last = at + t.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}
