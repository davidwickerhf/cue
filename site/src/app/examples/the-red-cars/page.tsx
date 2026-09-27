import { ExamplePage } from "@/components/ExamplePage";
import { example } from "@/content/examples";
import { pageMetadata } from "@/lib/metadata";

const e = example("the-red-cars");

export const metadata = pageMetadata({
	title: `${e.title}: an archive history documentary made in Cue`,
	description: e.summary,
	path: `/examples/${e.slug}`,
});

export default function TheRedCarsPage() {
	return <ExamplePage example={e} />;
}
