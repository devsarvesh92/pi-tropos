import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dumbzone from "./src/dumbzone.js";
import sessions from "./src/sessions.js";

export default function (pi: ExtensionAPI) {
	dumbzone(pi);
	sessions(pi);
}
