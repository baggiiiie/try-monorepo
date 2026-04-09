import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const MAX_FD_RESULTS = 100;
const MAX_SUGGESTIONS = 20;

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return `${process.env.HOME ?? ""}/${path.slice(2)}`;
	}
	if (path === "~") {
		return homedir();
	}
	return path;
}

function stripEnclosingQuotes(value: string): string {
	return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function parseCompletionPrefix(prefix: string) {
	const withoutAt = prefix.replace(/^@/, "");
	const isQuoted = withoutAt.startsWith('"');
	return {
		rawPrefix: isQuoted ? withoutAt.slice(1) : withoutAt,
		isQuoted,
	};
}

function buildCompletionValue(path: string, forceQuote = false): string {
	return forceQuote || path.includes(" ") ? `"${path}"` : path;
}

function normalizePath(input: string, cwd: string): string {
	const path = stripEnclosingQuotes(expandHome(input.trim().replace(/^@/, "")));
	return resolve(cwd, path);
}

function toDisplayPath(value: string): string {
	return value.replace(/\\/g, "/");
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFdPathQuery(query: string): string {
	const normalized = toDisplayPath(query);
	if (!normalized.includes("/")) {
		return normalized;
	}

	const hasTrailingSeparator = normalized.endsWith("/");
	const trimmed = normalized.replace(/^\/+|\/+$/g, "");
	if (!trimmed) {
		return normalized;
	}

	const separatorPattern = "[\\\\/]";
	const segments = trimmed
		.split("/")
		.filter(Boolean)
		.map((segment) => escapeRegex(segment));
	if (segments.length === 0) {
		return normalized;
	}

	let pattern = segments.join(separatorPattern);
	if (hasTrailingSeparator) {
		pattern += separatorPattern;
	}
	return pattern;
}

function resolveScopedFuzzyQuery(rawQuery: string, cwd: string) {
	const normalizedQuery = toDisplayPath(rawQuery);
	const slashIndex = normalizedQuery.lastIndexOf("/");
	if (slashIndex === -1) {
		return null;
	}

	const displayBase = normalizedQuery.slice(0, slashIndex + 1);
	const query = normalizedQuery.slice(slashIndex + 1);
	let baseDir: string;

	if (displayBase.startsWith("~/")) {
		baseDir = expandHome(displayBase);
	} else if (displayBase.startsWith("/")) {
		baseDir = displayBase;
	} else {
		baseDir = join(cwd, displayBase);
	}

	try {
		if (!statSync(baseDir).isDirectory()) {
			return null;
		}
	} catch {
		return null;
	}

	return { baseDir, query, displayBase };
}

function scopedPathForDisplay(displayBase: string, relativePath: string): string {
	const normalizedRelativePath = toDisplayPath(relativePath);
	if (displayBase === "/") {
		return `/${normalizedRelativePath}`;
	}
	return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function walkMarkdownWithFd(baseDir: string, query: string) {
	const result = spawnSync(
		"fd",
		[
			"--base-directory",
			baseDir,
			"--max-results",
			String(MAX_FD_RESULTS),
			"--type",
			"f",
			"--type",
			"d",
			"--full-path",
			"--hidden",
			"--exclude",
			".git",
			"--exclude",
			".git/*",
			"--exclude",
			".git/**",
			...(query ? [buildFdPathQuery(query)] : []),
		],
		{
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			maxBuffer: 10 * 1024 * 1024,
		},
	);

	if (result.status !== 0 || !result.stdout) {
		return [] as Array<{ path: string; isDirectory: boolean }>;
	}

	return result.stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const displayLine = toDisplayPath(line);
			const isDirectory = displayLine.endsWith("/");
			const path = isDirectory ? displayLine.slice(0, -1) : displayLine;
			return { path, isDirectory };
		})
		.filter((entry) => {
			if (
				entry.path === ".git" ||
				entry.path.startsWith(".git/") ||
				entry.path.includes("/.git/")
			) {
				return false;
			}
			return entry.isDirectory || entry.path.toLowerCase().endsWith(".md");
		});
}

function scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
	const fileName = basename(filePath);
	const lowerFileName = fileName.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = 0;

	if (lowerFileName === lowerQuery) score = 100;
	else if (lowerFileName.startsWith(lowerQuery)) score = 80;
	else if (lowerFileName.includes(lowerQuery)) score = 50;
	else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;

	if (isDirectory && score > 0) score += 10;
	return score;
}

function getFallbackMarkdownCompletions(prefix: string, cwd = process.cwd()): AutocompleteItem[] | null {
	const { rawPrefix, isQuoted } = parseCompletionPrefix(prefix);
	const raw = rawPrefix;
	const input = expandHome(raw);
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
				if (!entry.name.toLowerCase().startsWith(filePart.toLowerCase())) return false;
				return entry.isDirectory() || entry.name.endsWith(".md");
			})
			.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			})
			.map((entry) => {
				const suffix = entry.isDirectory() ? "/" : "";
				const pathValue = `${rawBase}${entry.name}${suffix}`;
				return {
					value: buildCompletionValue(pathValue, isQuoted),
					label: `${entry.name}${suffix}`,
					description: pathValue,
				};
			});

		return entries.length > 0 ? entries : null;
	} catch {
		return null;
	}
}

function getMarkdownCompletions(prefix: string, cwd = process.cwd()): AutocompleteItem[] | null {
	const { rawPrefix, isQuoted } = parseCompletionPrefix(prefix);
	const rawQuery = expandHome(rawPrefix);
	const scopedQuery = resolveScopedFuzzyQuery(rawQuery, cwd);
	const fdBaseDir = scopedQuery?.baseDir ?? cwd;
	const fdQuery = scopedQuery?.query ?? rawQuery;
	const entries = walkMarkdownWithFd(fdBaseDir, fdQuery)
		.map((entry) => ({
			...entry,
			score: fdQuery ? scoreEntry(entry.path, fdQuery, entry.isDirectory) : 1,
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_SUGGESTIONS)
		.map((entry) => {
			const displayPath = scopedQuery
				? scopedPathForDisplay(scopedQuery.displayBase, entry.path)
				: entry.path;
			const pathValue = entry.isDirectory ? `${displayPath}/` : displayPath;
			return {
				value: buildCompletionValue(pathValue, isQuoted),
				label: `${basename(entry.path)}${entry.isDirectory ? "/" : ""}`,
				description: pathValue,
			};
		});

	if (entries.length > 0) {
		return entries;
	}

	return getFallbackMarkdownCompletions(prefix, cwd);
}

type LaunchCommand = {
	command: string;
	args: string[];
	label: string;
};

type OpenResult = {
	status: number;
	label: string;
	error?: string;
};

type ManagedServerState = {
	pid: number;
	port: number;
};

type ManagedOwnerState = {
	password: string;
	token: string;
};

type ManagedManifest = {
	notes: Record<string, { id: string; shareId: string }>;
};

type ManagedPaths = ReturnType<typeof getProjectJotPaths>;

const JOT_PORT_START = 3210;
const JOT_PORT_SCAN_COUNT = 20;
const JOT_START_TIMEOUT_MS = 15000;
const OWNER_SESSION_COOKIE = "md_owner_session";

function ensureFileExists(filePath: string) {
	mkdirSync(dirname(filePath), { recursive: true });
	if (!existsSync(filePath)) {
		writeFileSync(filePath, "", "utf8");
	}
}

function getProjectJotPaths(cwd: string) {
	const root = join(cwd, ".pi", "jot");
	const dataDir = join(root, "data");
	const notesDir = join(dataDir, "notes");
	return {
		root,
		dataDir,
		notesDir,
		authFilePath: join(dataDir, "auth.json"),
		serverStatePath: join(root, "server.json"),
		serverLogPath: join(root, "server.log"),
		ownerStatePath: join(root, "owner.json"),
		manifestPath: join(root, "manifest.json"),
	};
}

function toWorkspacePath(filePath: string, cwd: string): string {
	const relativePath = toDisplayPath(relative(cwd, filePath));
	if (!relativePath || relativePath === ".") {
		return basename(filePath);
	}
	if (relativePath === ".." || relativePath.startsWith("../")) {
		return toDisplayPath(filePath);
	}
	return relativePath;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJsonFile(filePath: string, value: unknown) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadManifest(paths: ManagedPaths): ManagedManifest {
	return readJsonFile<ManagedManifest>(paths.manifestPath, { notes: {} });
}

function saveManifest(paths: ManagedPaths, manifest: ManagedManifest) {
	writeJsonFile(paths.manifestPath, manifest);
}

function readManagedServerState(serverStatePath: string): ManagedServerState | null {
	const state = readJsonFile<Partial<ManagedServerState> | null>(serverStatePath, null);
	if (!state || typeof state.pid !== "number" || typeof state.port !== "number") {
		return null;
	}
	return { pid: state.pid, port: state.port };
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function wait(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopManagedServer(serverStatePath: string) {
	const state = readManagedServerState(serverStatePath);
	if (!state) return;

	try {
		process.kill(state.pid, "SIGTERM");
	} catch {}

	for (let attempt = 0; attempt < 20; attempt++) {
		if (!isProcessRunning(state.pid)) break;
		await wait(100);
	}

	if (isProcessRunning(state.pid)) {
		try {
			process.kill(state.pid, "SIGKILL");
		} catch {}
	}

	try {
		unlinkSync(serverStatePath);
	} catch {}
}

async function isPortAvailable(port: number): Promise<boolean> {
	return await new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true));
		});
	});
}

async function pickPort(preferredPort: number) {
	for (let index = 0; index < JOT_PORT_SCAN_COUNT; index++) {
		const port = preferredPort + index;
		if (await isPortAvailable(port)) {
			return port;
		}
	}
	throw new Error(`Couldn't find a free port starting at ${preferredPort}`);
}

function resolveJotLaunch() {
	if (process.platform !== "win32") {
		const whichResult = spawnSync("which", ["jot"], {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			env: process.env,
		});
		const jotPath = whichResult.stdout?.trim();
		if (whichResult.status === 0 && jotPath) {
			try {
				const realJotPath = realpathSync(jotPath);
				const serverPath = resolve(dirname(realJotPath), "..", "dist", "server.js");
				if (existsSync(serverPath)) {
					return { command: process.execPath, args: [serverPath], needsServeCommand: false };
				}
			} catch {}
			return { command: process.execPath, args: [jotPath], needsServeCommand: true };
		}
	}

	return { command: "jot", args: [], needsServeCommand: true };
}

async function spawnDetached(command: string, args: string[], logPath: string, cwd: string) {
	mkdirSync(dirname(logPath), { recursive: true });
	const stdout = openSync(logPath, "a");
	const stderr = openSync(logPath, "a");

	try {
		const child = await new Promise<{ pid: number }>((resolve, reject) => {
			const proc = spawn(command, args, {
				cwd,
				detached: true,
				stdio: ["ignore", stdout, stderr],
				env: process.env,
			});

			proc.once("error", reject);
			proc.once("spawn", () => {
				proc.unref();
				resolve({ pid: proc.pid ?? 0 });
			});
		});

		return child;
	} finally {
		closeSync(stdout);
		closeSync(stderr);
	}
}

function readServerLogTail(logPath: string) {
	try {
		const text = readFileSync(logPath, "utf8").trim();
		if (!text) return "";
		const lines = text.split("\n");
		return lines.slice(-20).join("\n");
	} catch {
		return "";
	}
}

async function isServerHealthy(port: number) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`);
		return response.ok;
	} catch {
		return false;
	}
}

async function waitForServer(port: number) {
	const startedAt = Date.now();

	while (Date.now() - startedAt < JOT_START_TIMEOUT_MS) {
		if (await isServerHealthy(port)) {
			return;
		}
		await wait(200);
	}

	throw new Error(`Timed out waiting for jot on port ${port}`);
}

async function ensureJotServer(cwd: string) {
	const paths = getProjectJotPaths(cwd);
	const previousState = readManagedServerState(paths.serverStatePath);

	if (previousState && isProcessRunning(previousState.pid) && (await isServerHealthy(previousState.port))) {
		return previousState;
	}

	await stopManagedServer(paths.serverStatePath);

	const port = await pickPort(previousState?.port ?? JOT_PORT_START);
	const jotLaunch = resolveJotLaunch();
	const child = await spawnDetached(
		jotLaunch.command,
		[
			...jotLaunch.args,
			...(jotLaunch.needsServeCommand ? ["serve"] : []),
			`--port=${port}`,
			`--data=${paths.dataDir}`,
		],
		paths.serverLogPath,
		cwd,
	);

	writeJsonFile(paths.serverStatePath, { pid: child.pid, port } satisfies ManagedServerState);

	try {
		await waitForServer(port);
	} catch (error) {
		const logTail = readServerLogTail(paths.serverLogPath);
		throw new Error(
			`${error instanceof Error ? error.message : "Failed to start jot"}${logTail ? `\n\n${logTail}` : ""}`,
		);
	}

	return { pid: child.pid, port };
}

async function apiRequest<T>(
	port: number,
	path: string,
	options?: { method?: string; body?: unknown; ownerToken?: string },
): Promise<T> {
	const headers: Record<string, string> = {};
	if (options?.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	if (options?.ownerToken) {
		headers.Cookie = `${OWNER_SESSION_COOKIE}=${encodeURIComponent(options.ownerToken)}`;
	}

	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: options?.method ?? "GET",
		headers,
		body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
	});

	let payload: any = null;
	try {
		payload = await response.json();
	} catch {}

	if (!response.ok) {
		throw new Error(payload?.error || payload?.errors?.join(", ") || `Request failed (${response.status})`);
	}

	return payload as T;
}

async function validateOwnerToken(port: number, token: string) {
	try {
		await apiRequest(port, "/api/notes?q=", { ownerToken: token });
		return true;
	} catch {
		return false;
	}
}

function loadOwnerState(paths: ManagedPaths) {
	return readJsonFile<ManagedOwnerState | null>(paths.ownerStatePath, null);
}

function saveOwnerState(paths: ManagedPaths, state: ManagedOwnerState) {
	writeJsonFile(paths.ownerStatePath, state);
}

function resetManagedOwner(paths: ManagedPaths) {
	try {
		unlinkSync(paths.authFilePath);
	} catch {}
	try {
		unlinkSync(paths.ownerStatePath);
	} catch {}
}

async function ensureOwnerToken(cwd: string, port: number) {
	const paths = getProjectJotPaths(cwd);
	const ownerState = loadOwnerState(paths);

	if (ownerState?.token && (await validateOwnerToken(port, ownerState.token))) {
		return ownerState.token;
	}

	if (ownerState?.password) {
		try {
			const payload = await apiRequest<{ token: string }>(port, "/api/auth/login", {
				method: "POST",
				body: { password: ownerState.password },
			});
			saveOwnerState(paths, { ...ownerState, token: payload.token });
			return payload.token;
		} catch {}
	}

	const viewer = await apiRequest<{ authConfigured: boolean }>(port, "/api/viewer");
	if (viewer.authConfigured) {
		resetManagedOwner(paths);
	}

	const password = `pi-jot-${randomUUID()}`;
	const payload = await apiRequest<{ token: string }>(port, "/api/auth/setup", {
		method: "POST",
		body: { password, confirmPassword: password },
	});
	saveOwnerState(paths, { password, token: payload.token });
	return payload.token;
}

function ensureMarkdownLink(linkPath: string, targetPath: string) {
	try {
		unlinkSync(linkPath);
	} catch {}
	symlinkSync(targetPath, linkPath);
}

function findManifestNoteByWorkspacePath(paths: ManagedPaths, workspacePath: string) {
	const manifest = loadManifest(paths);
	const entry = manifest.notes[workspacePath];
	if (entry) {
		return { manifest, entry };
	}

	const noteMetaFiles = readdirSync(paths.notesDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => join(paths.notesDir, entry.name));

	for (const filePath of noteMetaFiles) {
		const meta = readJsonFile<{ id?: string; shareId?: string; title?: string } | null>(filePath, null);
		if (meta?.title === workspacePath && meta.id && meta.shareId) {
			manifest.notes[workspacePath] = { id: meta.id, shareId: meta.shareId };
			saveManifest(paths, manifest);
			return { manifest, entry: manifest.notes[workspacePath] };
		}
	}

	return { manifest, entry: null };
}

async function ensureManagedNote(filePath: string, cwd: string, port: number, ownerToken: string) {
	const paths = getProjectJotPaths(cwd);
	mkdirSync(paths.notesDir, { recursive: true });
	ensureFileExists(filePath);

	const workspacePath = toWorkspacePath(filePath, cwd);
	const markdown = readFileSync(filePath, "utf8");
	const { manifest, entry: existingEntry } = findManifestNoteByWorkspacePath(paths, workspacePath);
	let entry = existingEntry;

	if (entry) {
		try {
			await apiRequest(port, `/api/notes/${entry.id}`, { ownerToken });
		} catch {
			delete manifest.notes[workspacePath];
			entry = null;
		}
	}

	if (!entry) {
		const created = await apiRequest<{ note: { id: string; shareId: string } }>(port, "/api/notes", {
			method: "POST",
			ownerToken,
		});
		entry = { id: created.note.id, shareId: created.note.shareId };
		manifest.notes[workspacePath] = entry;
	}

	const markdownPath = join(paths.notesDir, `${entry.id}.md`);
	ensureMarkdownLink(markdownPath, filePath);
	await apiRequest(port, `/api/notes/${entry.id}`, {
		method: "PUT",
		ownerToken,
		body: {
			title: workspacePath,
			markdown,
			shareAccess: "edit",
		},
	});

	saveManifest(paths, manifest);
	return {
		workspacePath,
		id: entry.id,
		shareId: entry.shareId,
	};
}

function getOpenCommands(target: string): LaunchCommand[] {
	switch (process.platform) {
		case "darwin":
			return [{ command: "open", args: [target], label: "browser" }];
		case "win32":
			return [{ command: "cmd", args: ["/c", "start", "", target], label: "browser" }];
		default:
			return [{ command: "xdg-open", args: [target], label: "browser" }];
	}
}

function openTarget(target: string, cwd: string): OpenResult {
	let lastResult: OpenResult | null = null;

	for (const launcher of getOpenCommands(target)) {
		const result = spawnSync(launcher.command, launcher.args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			env: process.env,
		});

		if (!result.error && result.status === 0) {
			return { status: 0, label: launcher.label };
		}

		lastResult = {
			status: result.status ?? 1,
			label: launcher.label,
			error:
				result.error?.message ||
				result.stderr?.trim() ||
				result.stdout?.trim() ||
				undefined,
		};
	}

	return lastResult ?? { status: 127, label: "browser", error: "No browser launcher available" };
}

export default function jotExtension(pi: ExtensionAPI) {
	pi.registerCommand("jot", {
		description: "Open a markdown file in jot in the browser",
		getArgumentCompletions: (prefix) => getMarkdownCompletions(prefix),
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				console.error("/jot requires interactive mode");
				return;
			}

			const rawPath = args.trim() || (await ctx.ui.input("Open with jot", "notes.md"))?.trim();
			if (!rawPath) return;

			try {
				const filePath = normalizePath(rawPath, ctx.cwd);
				const server = await ensureJotServer(ctx.cwd);
				const ownerToken = await ensureOwnerToken(ctx.cwd, server.port);
				const note = await ensureManagedNote(filePath, ctx.cwd, server.port, ownerToken);
				const url = `http://127.0.0.1:${server.port}/s/${note.shareId}`;
				const result = openTarget(url, ctx.cwd);

				if (result.status === 0) {
					ctx.ui.notify(`Opened ${note.workspacePath} in jot`, "info");
				} else {
					ctx.ui.notify(
						`jot is running at ${url}, but opening the browser failed${result.error ? `: ${result.error}` : ""}`,
						"error",
					);
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Failed to open jot", "error");
			}
		},
	});
}
