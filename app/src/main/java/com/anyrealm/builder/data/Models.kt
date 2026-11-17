package com.anyrealm.builder.data

import com.google.gson.annotations.SerializedName

/**
 * The GitHub shapes this app reads.
 *
 * These are plain classes with Gson annotations rather than kotlinx.serialization
 * models, for one practical reason: kotlinx.serialization needs a compiler plugin
 * whose version must match the Kotlin compiler exactly, and that is a coupling
 * this app gains nothing from. Gson reads fields reflectively and needs no plugin.
 *
 * Only the fields actually used are declared. Gson ignores unknown keys by
 * default, which matters because GitHub adds fields on their schedule.
 */

class WorkflowRun {
    var id: Long = 0
    var name: String? = null

    @SerializedName("workflow_id")
    var workflowId: Long? = null

    var status: String? = null
    var conclusion: String? = null

    @SerializedName("html_url")
    var htmlUrl: String? = null

    @SerializedName("head_branch")
    var headBranch: String? = null

    @SerializedName("created_at")
    var createdAt: String? = null

    @SerializedName("updated_at")
    var updatedAt: String? = null

    @SerializedName("run_started_at")
    var runStartedAt: String? = null

    /**
     * True only when the run finished *and* succeeded.
     *
     * Every use site compares this rather than `status`, because GitHub reports
     * `status = "completed"` for a failed run too, and treating that as success is
     * how a front end promises an artefact that was never uploaded.
     */
    val succeeded: Boolean get() = status == "completed" && conclusion == "success"
    val finished: Boolean get() = status == "completed"

    /** Stable, readable label: id first, because names repeat across branches. */
    fun label(): String = "#$id" + (name?.takeIf { it.isNotBlank() }?.let { " $it" } ?: "")
}

class WorkflowRunsPage {
    @SerializedName("total_count")
    var totalCount: Int = 0

    @SerializedName("workflow_runs")
    var workflowRuns: List<WorkflowRun> = emptyList()
}

class Artifact {
    var id: Long = 0
    var name: String = ""

    @SerializedName("size_in_bytes")
    var sizeInBytes: Long = 0

    var expired: Boolean = false

    @SerializedName("created_at")
    var createdAt: String? = null
}

class ArtifactsPage {
    @SerializedName("total_count")
    var totalCount: Int = 0

    var artifacts: List<Artifact> = emptyList()
}

class JobStep {
    var name: String? = null
    var status: String? = null
    var conclusion: String? = null
    var number: Int? = null
}

class Job {
    var id: Long = 0
    var name: String? = null
    var status: String? = null
    var conclusion: String? = null
    var steps: List<JobStep> = emptyList()
}

class JobsPage {
    @SerializedName("total_count")
    var totalCount: Int = 0

    var jobs: List<Job> = emptyList()
}

class Workflow {
    var id: Long = 0
    var name: String = ""
    var path: String = ""
    var state: String? = null
}

class WorkflowsPage {
    @SerializedName("total_count")
    var totalCount: Int = 0

    var workflows: List<Workflow> = emptyList()
}

/**
 * A dispatch result.
 *
 * The API answers a workflow dispatch with 204 and no body, so the run has to be
 * found afterwards by listing recent runs and matching one that started at or
 * after the dispatch. That is why `dispatchedAtEpochSeconds` is carried: it is the
 * only way to tell the run just created from the previous one.
 */
data class Dispatched(
    val workflowFile: String,
    val ref: String,
    val dispatchedAtEpochSeconds: Long,
    val run: WorkflowRun? = null,
)

/** Where a watch is in its life, in the words a user sees. */
enum class RunPhase {
    Queued, Running, Succeeded, Failed, Cancelled, TimedOut, Unknown;

    companion object {
        fun of(status: String?, conclusion: String?): RunPhase = when {
            status == null -> Unknown
            status == "completed" -> when (conclusion) {
                "success" -> Succeeded
                "cancelled" -> Cancelled
                "timed_out" -> TimedOut
                // action_required, stale, startup_failure and null all mean the
                // build did not produce what was asked for.
                else -> Failed
            }
            status in setOf("queued", "waiting", "requested", "pending") -> Queued
            else -> Running
        }
    }
}
