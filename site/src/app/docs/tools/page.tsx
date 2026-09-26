import { A, C, CodeBlock, DocPage, H2 } from "@/components/docs/Prose";
import tools from "@/content/tools.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";
import { REPO } from "@/lib/site";

const PAGE = doc("/docs/tools");

export const metadata = pageMetadata({
	title: "Agent tool reference",
	description: `All ${tools.count} tools Cue gives AI agents over MCP and in the Agent panel, with their descriptions and inputs, generated from the app's source.`,
	path: PAGE.href,
});

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

type Input = (typeof tools.groups)[number]["tools"][number]["inputs"][number] & {
	default?: string;
	note?: string;
	nullable?: boolean;
};

function InputRow({ input }: { input: Input }) {
	return (
		<li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
			<code className="font-mono text-[13px] text-white">{input.name}</code>
			<span className="font-mono text-[12px] break-all text-muted">
				{input.type}
				{input.nullable ? " | null" : ""}
			</span>
			<span className="text-[12px] text-[#6f6f6f]">
				{input.required ? "required" : input.default !== undefined ? `default ${input.default}` : "optional"}
			</span>
			{input.note && <span className="basis-full text-[13px] text-muted">{input.note}</span>}
		</li>
	);
}

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={tools.groups.map((g) => ({ id: slug(g.title), label: g.title }))}
			intro={
				<p>
					Every tool an agent can call, {tools.count} in all, grouped as in the app&apos;s source. The same list is served to MCP
					clients and to the agents in the Agent panel; the editor itself uses the same actions.
				</p>
			}
		>
			<p>
				Times are in milliseconds. Positions on the frame are shares of the canvas from 0 to 1. Ids come from <C>get_state</C>{" "}
				and <C>get_timeline</C> (tracks like <C>V1</C>, clips <C>c_…</C>, media <C>a_…</C>, markers <C>m_…</C>). Agents are told to
				read <C>get_guide</C> once before editing. To try a tool from a terminal, clone the repository and run:
			</p>
			<CodeBlock>{"node scripts/mcp-call.mjs list"}</CodeBlock>
			<p className="text-[14px] text-muted">
				This page is generated from <A href={`${REPO}/blob/main/${tools.source}`}>{tools.source}</A>. Nested object inputs
				(clip patches, styles, settings) are described in each tool&apos;s text.
			</p>

			{tools.groups.map((group) => (
				<section key={group.title} aria-labelledby={slug(group.title)} className="flex flex-col gap-3">
					<H2 id={slug(group.title)}>{group.title}</H2>
					<div className="flex flex-col gap-3">
						{group.tools.map((tool) => (
							<article key={tool.name} id={tool.name} className="scroll-mt-6 rounded-xl border border-line p-4">
								<h3 className="font-mono text-[15px] font-semibold text-white">
									<a href={`#${tool.name}`} className="hover:underline hover:underline-offset-4">
										{tool.name}
									</a>
								</h3>
								<p className="mt-1.5 text-[14px] leading-relaxed text-neutral-300">{tool.description}</p>
								{tool.inputs.length > 0 ? (
									<ul className="mt-2 divide-y divide-line border-t border-line">
										{tool.inputs.map((input) => (
											<InputRow key={input.name} input={input as Input} />
										))}
									</ul>
								) : (
									<p className="mt-2 text-[12px] text-[#6f6f6f]">No inputs.</p>
								)}
							</article>
						))}
					</div>
				</section>
			))}
		</DocPage>
	);
}
