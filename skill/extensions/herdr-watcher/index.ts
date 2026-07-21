/**
 * Herdr Watcher
 *
 * Watches background work and injects a session message when it completes —
 * so an orchestrating agent (smashhh) can end its turn after delegating and
 * stay responsive, instead of blocking on wait loops.
 *
 * Completion signals, in order of reliability:
 * 1. `file` (recommended): fires when the watched file's mtime passes the
 *    watch registration time. Files are the source of truth — every
 *    delegated task should have a contract file (report, story, etc.).
 * 2. pane status: fires when the pane's agent_status stops being "working".
 *    (Herdr detection occasionally gets stuck at "working" — use `file`.)
 *
 * Tools:
 * - herdr_watch { pane, note?, file? }  — start watching
 * - herdr_unwatch { pane }              — stop watching
 *
 * Watches persist across session reloads in watches.json.
 * Tick diagnostics go to debug.log (same directory).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

interface Watch {
	note?: string;
	/** Contract file: fire when its mtime passes registeredAt. */
	file?: string;
	/** Epoch ms when the watch was registered. */
	registeredAt: number;
}

const EXT_DIR = join(homedir(), ".pi", "agent", "extensions", "herdr-watcher");
const STATE_FILE = join(EXT_DIR, "watches.json");
const DEBUG_FILE = join(EXT_DIR, "debug.log");

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
let timer: ReturnType<typeof setInterval> | null = null;

function debug(msg: string): void {
	try {
		mkdirSync(dirname(DEBUG_FILE), { recursive: true });
		appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${msg}\n`);
	} catch {
		// never let logging break the watcher
	}
}

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

/** Returns the file's mtime in epoch ms, or null if it doesn't exist yet. */
function fileMtime(path: string): number | null {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return null;
	}
}

export default function herdrWatcher(pi: ExtensionAPI) {
	pi.registerTool({
		name: "herdr_watch",
		label: "Herdr Watch",
		description:
			"Watch background work; the session is notified on completion. Pass `file` (absolute path to the task's contract/report file) for the reliable trigger — it fires when the file is written after registration. Without `file`, falls back to the pane's agent_status leaving 'working' (less reliable).",
		parameters: Type.Object({
			pane: Type.String({ description: "Pane ID, e.g. w6:p2" }),
			note: Type.Optional(Type.String({ description: "Context to include in the notification" })),
			file: Type.Optional(
				Type.String({
					description: "Absolute path of the contract file whose write signals completion",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			watches.set(params.pane, {
				note: params.note,
				file: params.file,
				registeredAt: Date.now(),
			});
			saveWatches(watches);
			debug(`watch set: ${params.pane} file=${params.file ?? "(status only)"}`);
			return {
				content: [
					{
						type: "text",
						text: `Watching ${params.pane}${params.file ? ` (file trigger: ${params.file})` : " (status trigger only — prefer passing file)"} — end your turn now and react to the [herdr-watcher] message.`,
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
		debug(`session_start: ${watches.size} watch(es) restored`);
		timer = setInterval(async () => {
			if (watches.size === 0) return;
			for (const [pane, meta] of [...watches]) {
				let what: string | null = null;

				if (meta.file) {
					const mtime = fileMtime(meta.file);
					debug(`${pane}: file mtime=${mtime} registeredAt=${meta.registeredAt}`);
					if (mtime !== null && mtime > meta.registeredAt) {
						what = `contract file written: ${meta.file}`;
					}
				} else {
					let status: string | null;
					try {
						status = await paneStatus(pane);
					} catch {
						debug(`${pane}: status check threw, skipping tick`);
						continue;
					}
					debug(`${pane}: status=${status}`);
					if (status !== "working") {
						what =
							status === null
								? "is no longer reachable (pane closed or herdr error)"
								: `agent_status=${status}`;
					}
				}

				if (!what) continue;
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
