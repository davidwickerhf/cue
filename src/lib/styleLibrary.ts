import { createStore } from "./state";

/** Style currently selected by a person or an agent in the Generate panel. */
export const styleSelection = createStore<{ id: string | null }>({ id: null });
