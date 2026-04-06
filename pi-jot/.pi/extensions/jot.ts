import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return `${process.env.HOME ?? ""}/${path.slice(2)}`;
	}
	return path;
}

function normalizePath(input: string, cwd: string): string {
	const path = expandHome(input.trim().replace(/^@/, ""));
	return resolve(cwd, path);
}

function getMarkdownCompletions(prefix: string): AutocompleteItem[] | null {
	const raw = prefix.replace(/^@/, "");
	const input = expandHome(raw);
	const cwd = process.cwd();
	const endsWithSlash = input.endsWith("/");

	let dirInput: string;
	let filePart: string;
	let rawBase: string;

	if (endsWithSlash) {
		dirInput = input;
		filePart = "";
		rawBase = raw;
	} else if (input.includes("/")) {
		dirInput = dirname(input);
		filePart = input.slice(input.lastIndexOf("/") + 1);
		rawBase = raw.slice(0, raw.lastIndexOf("/") + 1);
	} else {
		dirInput = ".";
		filePart = input;
		rawBase = "";
	}

	const absoluteDir = isAbsolute(dirInput) ? dirInput : resolve(cwd, dirInput);

	try {
		const entries = readdirSync(absoluteDir, { withFileTypes: true })
			.filter((entry) => {
				if (!entry.name.startsWith(filePart)) return false;
				return entry.isDirectory() || entry.name.endsWith(".md");
			})
			.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			})
			.map((entry) => {
				const suffix = entry.isDirectory() ? "/" : "";
				const value = `${rawBase}${entry.name}${suffix}`;
				return {
					value,
					label: entry.isDirectory() ? `${value} (dir)` : value,
				};
			});

		return entries.length > 0 ? entries : null;
	} catch {
		return null;
	}
}

export default function jotExtension(pi: ExtensionAPI) {
	pi.registerCommand("jot", {
		description: "Open a file in jot",
		getArgumentCompletions: (prefix) => getMarkdownCompletions(prefix),
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				console.error("/jot requires interactive mode");
				return;
			}

			const rawPath = args.trim() || (await ctx.ui.input("Open with jot", "notes.md"))?.trim();
			if (!rawPath) return;

			const filePath = normalizePath(rawPath, ctx.cwd);
			const exitCode = await ctx.ui.custom<number>((tui, _theme, _keybindings, done) => {
				tui.stop();

				try {
					const result = spawnSync("jot", [filePath], {
						cwd: ctx.cwd,
						stdio: "inherit",
						env: process.env,
					});

					if (result.error) {
						console.error(`Failed to launch jot: ${result.error.message}`);
						done(127);
					} else {
						done(result.status ?? 1);
					}
				} finally {
					tui.start();
					tui.requestRender(true);
				}

				return { render: () => [], invalidate: () => {} };
			});

			if (exitCode === 0) {
				ctx.ui.notify(`Closed jot: ${rawPath}`, "info");
			} else {
				ctx.ui.notify(`jot exited with code ${exitCode}`, "error");
			}
		},
	});
}
