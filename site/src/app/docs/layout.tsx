import { Footer, Header } from "@/components/Chrome";
import { DocsNav, DocsPager } from "@/components/docs/DocsNav";

/** Every docs page: the site header, a sidebar of pages, the page, and the footer. */
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
	return (
		<>
			<Header />
			<div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-5 pt-6 pb-24 lg:flex-row lg:gap-12 lg:pt-12">
				<DocsNav />
				<main className="min-w-0 max-w-[760px] flex-1">
					{children}
					<DocsPager />
				</main>
			</div>
			<Footer />
		</>
	);
}
