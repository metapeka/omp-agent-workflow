/** Общие типы orchestrator 0.5. Runtime-зависимостей нет. */

export type WorkflowMode =
	| "manual"
	| "assisted"
	| "yoda"
	| "yoda-supervised";

export const WORKFLOW_MODES: Record<WorkflowMode, true> = {
	manual: true,
	assisted: true,
	yoda: true,
	"yoda-supervised": true,
};

export function isWorkflowMode(value: unknown): value is WorkflowMode {
	return typeof value === "string" && Object.hasOwn(WORKFLOW_MODES, value);
}

export type Gate = "publish" | "contract" | "data" | "human";

export interface BudgetLimits {
	maxTasksPerSession: number;
	maxSpendUsd: number;
	maxMinutes: number;
}

export interface PlanConfig {
	version: 1;
	goal: string;
	baseBranch: string;
	baseRepo: string | null;
	worktreeRoot: string;
	backend: "orca" | "git";
	/** Отсутствует = `omp`; явное значение участвует в hash плана. */
	execution?: "omp" | "external";
	verify: string[];
	budgets: BudgetLimits;
}

export interface TaskSpec {
	id: string;
	title: string;
	deps: string[];
	branch: string;
	files: string[];
	acceptance: string[];
	verify: string[];
	review: boolean;
	gate: Gate | null;
}

export interface Autoplan {
	path: string;
	hash: string;
	config: PlanConfig;
	tasks: TaskSpec[];
}

export type TaskStatus = "running" | "verified" | "reviewed" | "failed";

export interface CheckResult {
	cmd: string;
	code: number;
	at: string;
}

export interface CompletedTask {
	id: string;
	commit: string;
	mergedAt: string;
	checks: CheckResult[];
}

export interface CurrentTask {
	id: string;
	branch: string;
	worktree: string;
	status: TaskStatus;
	commit: string | null;
	startedAt: string;
	checks: CheckResult[];
}

export interface RunInfo {
	id: string;
	active: boolean;
	startedAt: string;
	sessionFile: string | null;
	mode: WorkflowMode;
}

export interface BudgetState {
	tasksThisSession: number;
	spendUsd: number;
	costOffsets: Record<string, number>;
	/** Измеренный вклад каждого session-файла; spend = Σ вкладов (0.7.4). */
	costTotals: Record<string, number>;
}

export interface ContextState {
	percent: number | null;
	at: string;
}

export interface HandoffState {
	at: string;
	reason: string;
}

export interface StopState {
	reason: string;
	detail: string;
	at: string;
}

export interface OrchestratorState {
	version: 1;
	plan: { path: string; hash: string };
	run: RunInfo | null;
	current: CurrentTask | null;
	completed: CompletedTask[];
	attempts: Record<string, number>;
	budgets: BudgetState;
	context: ContextState | null;
	lastHandoff: HandoffState | null;
	stop: StopState | null;
}

export const KNOWN_STOP_REASONS = [
	"plan-missing",
	"plan-invalid",
	"plan-changed",
	"state-missing",
	"state-corrupt",
	"plan-done",
	"no-ready-task",
	"gate",
	"attempts-exceeded",
	"budget-tasks",
	"budget-spend",
	"budget-time",
	"cost-unavailable",
	"base-dirty",
	"merge-conflict",
	"verify-failed",
	"handoff-unavailable",
	"external-run",
] as const;

export type KnownStopReason = (typeof KNOWN_STOP_REASONS)[number];

export function isKnownStopReason(value: string): value is KnownStopReason {
	return (KNOWN_STOP_REASONS as readonly string[]).includes(value);
}
