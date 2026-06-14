// @ts-nocheck
// Extension loaded by pi via jiti; types resolved at runtime from pi's node_modules.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type TriggerSource = "tool" | "command";

type UsageDetails = {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
	model: string | null;
};

type TriggerResult = {
	status: "started" | "already_running";
	message: string;
	details: Record<string, unknown>;
};

const TOOL_NAME = "compact_context";
const COMMAND_NAME = "compact-context";

function normalizeInstructions(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function getUsageDetails(ctx: ExtensionContext): UsageDetails {
	const usage = ctx.getContextUsage();
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;

	return {
		tokens: usage?.tokens ?? null,
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
		percent: usage?.percent ?? null,
		model,
	};
}

function formatUsage(details: UsageDetails): string {
	if (details.tokens === null || details.contextWindow === null || details.percent === null) {
		return "";
	}

	return ` (${details.tokens.toLocaleString()} tokens, ${details.percent.toFixed(1)}% of ${details.contextWindow.toLocaleString()})`;
}

export default function (pi: ExtensionAPI) {
	let isCompacting = false;
	let startedAt: number | null = null;

	const triggerCompaction = (
		ctx: ExtensionContext,
		customInstructions: string | undefined,
		source: TriggerSource,
	): TriggerResult => {
		const instructions = normalizeInstructions(customInstructions);
		const usageBefore = getUsageDetails(ctx);

		if (isCompacting) {
			const message = "Context compaction is already running; no new compaction was started.";
			if (ctx.hasUI) {
				ctx.ui.notify(message, "warning");
			}
			return {
				status: "already_running",
				message,
				details: {
					status: "already_running",
					source,
					startedAt,
					usageBefore,
				},
			};
		}

		isCompacting = true;
		startedAt = Date.now();

		if (ctx.hasUI) {
			ctx.ui.notify(`Context compaction started${formatUsage(usageBefore)}.`, "info");
		}

		try {
			ctx.compact({
				customInstructions: instructions,
				onComplete: (result) => {
					isCompacting = false;
					startedAt = null;

					if (ctx.hasUI) {
						ctx.ui.notify(
							`Context compaction completed (${result.tokensBefore.toLocaleString()} tokens summarized).`,
							"info",
						);
					}
				},
				onError: (error) => {
					isCompacting = false;
					startedAt = null;

					if (ctx.hasUI) {
						ctx.ui.notify(`Context compaction failed: ${error.message}`, "error");
					}
				},
			});
		} catch (error) {
			isCompacting = false;
			startedAt = null;
			throw error;
		}

		const message = `Context compaction started${formatUsage(usageBefore)}. Stop after this tool call and wait for compaction before continuing long-running work.`;

		return {
			status: "started",
			message,
			details: {
				status: "started",
				source,
				startedAt,
				customInstructionsProvided: instructions !== undefined,
				usageBefore,
			},
		};
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Compact Context",
		description:
			"Trigger pi's built-in context compaction. Compaction starts asynchronously; completion or failure is reported through UI notifications when available.",
		promptSnippet:
			"Trigger pi's built-in context compaction with optional summary focus instructions.",
		promptGuidelines: [
			"Use compact_context conservatively when the conversation context has grown large, before switching to a new phase, or when the user asks to compress or preserve context.",
			"Pass compact_context customInstructions when important current goals, decisions, files, blockers, or next steps must be preserved in the compaction summary.",
			"After calling compact_context, do not continue long-running work or call more tools in the same response; stop and wait for compaction to complete before continuing.",
			"Do not use compact_context for normal short conversations or as a replacement for task-specific summaries requested by the user.",
		],
		parameters: Type.Object(
			{
				customInstructions: Type.Optional(
					Type.String({
						description:
							"Optional focus instructions for the compaction summary, such as goals, decisions, modified files, blockers, and next steps to preserve.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const result = triggerCompaction(ctx, params.customInstructions, "tool");
			return {
				content: [{ type: "text", text: result.message }],
				details: result.details,
				terminate: true,
			};
		},
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Trigger context compaction with optional focus instructions",
		handler: async (args, ctx) => {
			try {
				triggerCompaction(ctx, args, "command");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) {
					ctx.ui.notify(`Context compaction failed to start: ${message}`, "error");
				}
				throw error;
			}
		},
	});
}
