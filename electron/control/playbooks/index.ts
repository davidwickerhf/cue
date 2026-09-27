import { AGENT_WORKFLOW } from "./agentWorkflow";
import { EDITING_CRAFT } from "./editingCraft";
import { EXAMPLE_OK } from "./exampleOk";
import { EXAMPLE_RED_CARS } from "./exampleRedCars";
import { FINDING_ASSETS } from "./findingAssets";
import { FIRST_PASS } from "./firstPass";
import { MATCH_REFERENCE } from "./matchReference";
import { MOTION_DESIGN } from "./motionDesign";
import { SCREEN_DEMO } from "./screenDemo";
import { OTHER_STYLES } from "./styles";
import { TECHNIQUES } from "./techniques";
import { VOX_EXPLAINER } from "./voxExplainer";

/**
 * Playbooks: what Cue's agents know about making videos, so they don't have to
 * work it out each time. A playbook is a markdown document: how to work in Cue,
 * editing craft, motion design, recognisable styles taken apart into
 * techniques with Cue's own tools and numbers, and worked examples. Agents read them with
 * list_playbooks and get_playbook.
 */
export interface Playbook {
	id: string;
	name: string;
	category: "workflow" | "craft" | "style" | "example";
	/** One line: what it covers. */
	summary: string;
	/** When an agent should read it. */
	useWhen: string;
	body: string;
}

export const PLAYBOOKS: Playbook[] = [
	AGENT_WORKFLOW,
	FIRST_PASS,
	FINDING_ASSETS,
	MATCH_REFERENCE,
	TECHNIQUES,
	EDITING_CRAFT,
	MOTION_DESIGN,
	VOX_EXPLAINER,
	SCREEN_DEMO,
	...OTHER_STYLES,
	EXAMPLE_OK,
	EXAMPLE_RED_CARS,
];

export function playbook(id: string): Playbook {
	const found = PLAYBOOKS.find((p) => p.id === id);
	if (!found)
		throw new Error(`No playbook "${id}". Playbooks: ${PLAYBOOKS.map((p) => p.id).join(", ")}.`);
	return found;
}
