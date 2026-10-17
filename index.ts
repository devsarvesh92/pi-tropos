import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import smritikosh from "pi-smritikosh/index.js";
import barista from "./src/barista.js";
import dumbzone from "./src/dumbzone.js";
import sessions from "./src/sessions.js";

export default function (pi: ExtensionAPI) {
	barista(pi);
	dumbzone(pi);
	sessions(pi);
	smritikosh(pi);
}
