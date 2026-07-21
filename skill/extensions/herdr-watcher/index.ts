/**
 * Herdr Watcher
 *
 * Watches Herdr panes in the background and injects a session message when a
 * pane's agent_status stops being "working" — so an orchestrating agent
 * (smashhh) can end its turn after delegating and stay responsive, instead of
 * blocking on wait loops.
 *
 * Tools:
 * - herdr_watch { pane, note? }  — start watching a pane
 * - herdr_unwatch { pane }       — stop watching
 *
 * The watcher polls every 10s. When a watched pane leaves "working"
 * (done / idle / blocked / unreachable), it injects a [herdr-watcher] message
 * with triggerTurn, waking the agent to continue its loop.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";

interface Watch {
	note?: string;
}

const watches = new Map<string, Watch>();
let timer: ReturnType<typeof setInterval> | null = null;

function paneStatus(pane: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("herdr", ["pane", "get", pane], { timeout: 15000 }, (err, stdout) => {
			if (err) return resolve(null);
			try {
				const d = JSON.parse(stdout);
				resolve(d?.result?.pane?.agent_status ?? null);
			} catch {
				resolve(null);
			}
		});
	});
}

export default function herdrWatcher(pi: ExtensionAPI) {
	pi.registerTool({
		name: "herdr_watch",
		label: "Herdr Watch",
		description:
			"Watch a Herdr pane in the background; the session is notified when the pane's agent_status stops being 'working'. Use after `herdr pane run` to delegate without blocking the conversation.",
		parameters: Type.Object({
			pane: Type.String({ description: "Pane ID, e.g. w6:p2" }),
			note: Type.Optional(
				Type.String({ description: "Context to include in the completion notification" }),
			),
		}),
		async execute(_toolCallId, params) {
			watches.set(params.pane, { note: params.note });
			return {
				content: [
					{
						type: "text",
						text: `Watching ${params.pane} — you will be notified when it leaves 'working'. End your turn now and react to the [herdr-watcher] message.`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "herdr_unwatch",
		label: "Herdr Unwatch",
		description: "Stop watching a Herdr pane.",
		parameters: Type.Object({
			pane: Type.String({ description: "Pane ID, e.g. w6:p2" }),
		}),
		async execute(_toolCallId, params) {
			const had = watches.delete(params.pane);
			return {
				content: [
					{
						type: "text",
						text: had ? `Stopped watching ${params.pane}.` : `${params.pane} was not being watched.`,
					},
				],
			};
		},
	});

	pi.on("session_start", () => {
		if (timer) return; // idempotent across reloads
		timer = setInterval(async () => {
			if (watches.size === 0) return;
			for (const [pane, meta] of [...watches]) {
				let status: string | null;
				try {
					status = await paneStatus(pane);
				} catch {
					continue; // transient error; try again next tick
				}
				if (status === "working") continue;
				watches.delete(pane);
				const what =
					status === null
						? "is no longer reachable (pane closed or herdr error)"
						: `agent_status=${status}`;
				pi.sendMessage(
					{
						customType: "herdr-watcher",
						content: `[herdr-watcher] ${pane} ${what}.${meta.note ? ` ${meta.note}` : ""}`,
						display: true,
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
			}
		}, 10000);
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = null;
		watches.clear();
	});
}
