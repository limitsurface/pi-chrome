import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";

const CONFIG_DIR = resolve(homedir(), ".pi", "agent", "chrome-image-gen");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

type ToolTextResult = {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
};

async function getProjectUrl(): Promise<string> {
	try {
		const content = await readFile(CONFIG_FILE, "utf-8");
		const json = JSON.parse(content) as { projectUrl?: string };
		return json.projectUrl || "";
	} catch {
		return "";
	}
}

async function saveProjectUrl(url: string): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await writeFile(CONFIG_FILE, JSON.stringify({ projectUrl: url }, null, 2), "utf-8");
}

export default function registerImageTools(
	pi: ExtensionAPI,
	authorizedBridgeSend: (action: string, params: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) => Promise<unknown>,
	workspaceCwd: (ctx: ExtensionContext) => string,
): void {
	pi.registerTool({
		name: "chrome_generate_image",
		label: "Chrome Generate Image",
		description: "Generate a new image, perform reference-guided generation, or edit a canvas in DALL-E 3 inside ChatGPT using the Chrome companion extension. Saves the image to disk.",
		promptSnippet: "Generate a DALL-E 3 image via Chrome and save it locally.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Detailed description of the image to generate, or instructions on how to edit the reference images." }),
			outputPath: Type.String({ description: "Local path where the generated image should be saved." }),
			aspectRatio: Type.Optional(Type.String({ description: "Optional aspect ratio (e.g. '16:9', '1:1', '9:16'). Required only if no references are provided." })),
			referencePaths: Type.Optional(Type.Array(Type.String(), { description: "Optional list of local reference image paths to upload for multi-reference edits / guided generations." })),
			projectUrl: Type.Optional(Type.String({ description: "Optional override for the ChatGPT project URL workspace to use." })),
			thinking: Type.Optional(Type.Boolean({ description: "If true, enable reasoning/thinking mode in ChatGPT before dispatching." })),
			background: Type.Optional(
				Type.Boolean({ description: "If true, run silently in the background. Default false (user can watch Chrome work)." }),
			),
		}),
		async execute(
			_id: string,
			params: {
				prompt: string;
				outputPath: string;
				aspectRatio?: string;
				referencePaths?: string[];
				projectUrl?: string;
				thinking?: boolean;
				background?: boolean;
			},
			signal: AbortSignal,
			_onUpdate: (update: unknown) => void,
			ctx: ExtensionContext,
		): Promise<ToolTextResult> {
			const cwd = workspaceCwd(ctx);
			const absoluteOutputPath = resolve(cwd, params.outputPath);
			const referencePaths = params.referencePaths || [];
			const absoluteReferencePaths = referencePaths.map((r: string) => resolve(cwd, r));

			// Resolve project URL from params or fall back to local agent config file
			let projectUrl = params.projectUrl;
			if (!projectUrl) {
				projectUrl = await getProjectUrl();
			}

			// Send to the companion Chrome extension bridge with a 150s timeout
			const result = (await authorizedBridgeSend(
				"page.generate_image",
				{
					prompt: params.prompt,
					aspectRatio: params.aspectRatio,
					referencePaths: absoluteReferencePaths,
					projectUrl: projectUrl || undefined,
					thinking: params.thinking,
					foreground: !params.background,
				},
				150_000,
				signal,
			)) as { dataUrl?: string; error?: string };

			if (!result.dataUrl) {
				throw new Error(result.error ?? "Failed to retrieve generated image data.");
			}

			const base64 = result.dataUrl.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "");
			await mkdir(dirname(absoluteOutputPath), { recursive: true });
			await writeFile(absoluteOutputPath, Buffer.from(base64, "base64"));

			return {
				content: [{ type: "text", text: `Successfully generated DALL-E image and saved to: ${params.outputPath}` }],
				details: { outputPath: params.outputPath },
			};
		},
	});

	pi.registerTool({
		name: "chrome_init_project",
		label: "Chrome Init Project",
		description: "Dynamically create, name, and bind a new ChatGPT project in Chrome. Returns the project URL and persists it to local agent config.",
		promptSnippet: "Create and bind a new ChatGPT project workspace in Chrome.",
		parameters: Type.Object({
			projectName: Type.Optional(Type.String({ description: "Optional name for the new ChatGPT project. Default is 'gpt-image-cli'." })),
			background: Type.Optional(
				Type.Boolean({ description: "If true, run silently in the background. Default false." }),
			),
		}),
		async execute(
			_id: string,
			params: {
				projectName?: string;
				background?: boolean;
			},
			signal: AbortSignal,
			_onUpdate: (update: unknown) => void,
			_ctx: ExtensionContext,
		): Promise<ToolTextResult> {
			const projectName = params.projectName || "gpt-image-cli";

			// Send to the companion Chrome extension bridge with a 60s timeout
			const result = (await authorizedBridgeSend(
				"page.init_project",
				{
					projectName,
					foreground: !params.background,
				},
				60_000,
				signal,
			)) as { projectUrl?: string; error?: string };

			if (!result.projectUrl) {
				throw new Error(result.error ?? "Failed to initialize ChatGPT project workspace.");
			}

			// Persist the new project URL to our local config file
			await saveProjectUrl(result.projectUrl);

			return {
				content: [{ type: "text", text: `Successfully created and bound ChatGPT project workspace: ${result.projectUrl}` }],
				details: { projectUrl: result.projectUrl },
			};
		},
	});
}
