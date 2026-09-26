import "@fontsource-variable/dm-sans";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { platform } from "./lib/platform";

// Window chrome differs per platform (see .titlebar in index.css).
document.documentElement.dataset.platform = platform;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
