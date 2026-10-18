import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import smritikosh from "pi-smritikosh/index.js";
import barista from "./src/barista.js";
import bg from "./src/bg.js";
import dumbzone from "./src/dumbzone.js";
import footer from "./src/footer.js";
import peek from "./src/peek.js";
import sessions from "./src/sessions.js";

export default function (pi: ExtensionAPI) {
	barista(pi);
	bg(pi);
	dumbzone(pi);
	footer(pi);
	peek(pi);
	sessions(pi);
	smritikosh(pi);
}
