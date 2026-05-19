import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

type ToolTextResult = {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
};

export default function registerImageTools(
	pi: ExtensionAPI,
	authorizedBridgeSend: (action: string, params: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) => Promise<unknown>,
	workspaceCwd: (ctx: ExtensionContext) => string,
): void {
	pi.registerTool({
		name: "chrome_generate_image",
		label: "Chrome Generate Image",
		description: "Generate a new image in DALL-E 3 inside ChatGPT using the Chrome companion extension. Saves the image to disk.",
		promptSnippet: "Generate a DALL-E 3 image via Chrome and save it locally.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Detailed description of the image to generate." }),
			aspectRatio: Type.Optional(Type.String({ description: "Optional aspect ratio (e.g. '16:9', '1:1', '9:16')." })),
			outputPath: Type.String({ description: "Local path where the generated image should be saved." }),
			thinking: Type.Optional(Type.Boolean({ description: "If true, enable reasoning/thinking mode in ChatGPT before dispatching." })),
			background: Type.Optional(
				Type.Boolean({ description: "If true, run silently in the background. Default false (user can watch Chrome work)." }),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx: ExtensionContext): Promise<ToolTextResult> {
			const cwd = workspaceCwd(ctx);
			const absoluteOutputPath = resolve(cwd, params.outputPath);

			// Send to the companion Chrome extension bridge with a 120s timeout
			const result = (await authorizedBridgeSend(
				"page.generate_image",
				{
					prompt: params.prompt,
					aspectRatio: params.aspectRatio,
					thinking: params.thinking,
					foreground: !params.background,
				},
				120_000,
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
		name: "chrome_edit_image",
		label: "Chrome Edit Image",
		description: "Refine or edit an existing image by uploading it as a reference and executing a prompt in ChatGPT. Saves the result to disk.",
		promptSnippet: "Edit an existing image via DALL-E in Chrome and save it locally.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Instructions on how to refine/edit the image." }),
			referencePath: Type.String({ description: "Local path to the reference image to be uploaded." }),
			outputPath: Type.String({ description: "Local path where the edited image should be saved." }),
			thinking: Type.Optional(Type.Boolean({ description: "If true, enable reasoning/thinking mode in ChatGPT before dispatching." })),
			background: Type.Optional(
				Type.Boolean({ description: "If true, run silently in the background. Default false." }),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx: ExtensionContext): Promise<ToolTextResult> {
			const cwd = workspaceCwd(ctx);
			const absoluteReferencePath = resolve(cwd, params.referencePath);
			const absoluteOutputPath = resolve(cwd, params.outputPath);

			// Send to the companion Chrome extension bridge with a 150s timeout
			const result = (await authorizedBridgeSend(
				"page.edit_image",
				{
					prompt: params.prompt,
					referencePath: absoluteReferencePath,
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
				content: [{ type: "text", text: `Successfully edited reference image and saved result to: ${params.outputPath}` }],
				details: { outputPath: params.outputPath },
			};
		},
	});

	pi.registerTool({
		name: "chrome_init_project",
		label: "Chrome Init Project",
		description: "Dynamically create, name, and bind a new ChatGPT project 'gpt-image-cli' in Chrome. Returns the project URL.",
		promptSnippet: "Create a new 'gpt-image-cli' project workspace in ChatGPT.",
		parameters: Type.Object({
			background: Type.Optional(
				Type.Boolean({ description: "If true, run silently in the background. Default false." }),
			),
		}),
		async execute(_id, params, signal, _onUpdate, _ctx: ExtensionContext): Promise<ToolTextResult> {
			// Send to the companion Chrome extension bridge with a 60s timeout
			const result = (await authorizedBridgeSend(
				"page.init_project",
				{
					foreground: !params.background,
				},
				60_000,
				signal,
			)) as { projectUrl?: string; error?: string };

			if (!result.projectUrl) {
				throw new Error(result.error ?? "Failed to initialize ChatGPT project workspace.");
			}

			return {
				content: [{ type: "text", text: `Successfully created and bound ChatGPT project workspace: ${result.projectUrl}` }],
				details: { projectUrl: result.projectUrl },
			};
		},
	});
}
