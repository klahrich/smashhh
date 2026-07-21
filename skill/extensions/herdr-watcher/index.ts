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
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

interface Watch {
	note?: string;
	sentinelsAtBaseline: number;
}

// Watches persist across session reloads (session_shutdown clears timers
// but must not lose registered watches).
const STATE_FILE = join(homedir(), ".pi", "agent", "extensions", "herdr-watcher", "watches.json");

function loadWatches(): Map<string, Watch> {
	try {
		const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		return new Map(Object.entries(raw));
	} catch {
		return new Map();
	}
}

function saveWatches(watches: Map<string, Watch>): void {
	try {
		mkdirSync(dirname(STATE_FILE), { recursive: true });
		writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(watches), null, 2));
	} catch {
		// best effort; a lost save just means a re-watch next session
	}
}

const watches = loadWatches();

const DEBUG_FILE = join(homedir(), ".pi", "agent", "extensions", "herdr-watcher", "debug.log");

function debug(msg: string): void {
	try {
		mkdirSync(dirname(DEBUG_FILE), { recursive: true });
		appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${msg}\n`);
	} catch {
		// never let logging break the watcher
	}
}
let timer: ReturnType<typeof setInterval> | null = null;

const SENTINEL = "SMASHHH_TASK_COMPLETE:";

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

// herdr pane read prints raw text (not JSON). Count completion sentinels
// in the recent transcript: a fallback for when Herdr's agent-status
// detection gets stuck at "working". Count-based (not boolean) so that a
// stale sentinel from a previous task in scrollback doesn't mask a new one.
function paneSentinelCount(pane: string): Promise<number> {
	return new Promise((resolve) => {
		execFile(
			"herdr",
			["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "60"],
			{ timeout: 15000 },
			(err, stdout) => {
				if (err) return resolve(0);
				resolve(stdout.split(SENTINEL).length - 1);
			},
		);
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
			const sentinelsAtBaseline = await paneSentinelCount(params.pane);
			watches.set(params.pane, { note: params.note, sentinelsAtBaseline });
			saveWatches(watches);
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
			saveWatches(watches);
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
					debug(`${pane}: status check threw, skipping tick`);
					continue; // transient error; try again next tick
				}
				debug(`${pane}: status=${status} baseline=${meta.sentinelsAtBaseline}`);
				let what: string;
				if (status === "working") {
					// Status can get stuck; fall back to the completion sentinel.
					let sentinelCount = 0;
					try {
						sentinelCount = await paneSentinelCount(pane);
					} catch {
						debug(`${pane}: sentinel check threw, skipping tick`);
						continue;
					}
					debug(`${pane}: sentinels=${sentinelCount} baseline=${meta.sentinelsAtBaseline}`);
					if (sentinelCount <= meta.sentinelsAtBaseline) continue;
					what = "still reports agent_status=working, but a new completion sentinel appeared (stuck status detection)";
				} else {
					what =
						status === null
							? "is no longer reachable (pane closed or herdr error)"
							: `agent_status=${status}`;
				}
				debug(`${pane}: FIRING — ${what}`);
				watches.delete(pane);
				saveWatches(watches);
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
		// watches intentionally NOT cleared — they persist in STATE_FILE
	});
}
