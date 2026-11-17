package com.anyrealm.builder.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The GitHub shapes this app reads.
 *
 * Only the fields the front end actually uses are declared. kotlinx.serialization
 * is configured to ignore unknown keys, because GitHub adds fields regularly and a
 * strict schema would break the app on their release schedule rather than ours.
 */

@Serializable
data class WorkflowRun(
    val id: Long,
    val name: String? = null,
    @SerialName("workflow_id") val workflowId: Long? = null,
    val status: String? = null,
    val conclusion: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null,
    @SerialName("head_branch") val headBranch: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("run_started_at") val runStartedAt: String? = null,
) {
    /** True only when the run finished *and* succeeded. See below for why. */
    val succeeded: Boolean get() = status == "completed" && conclusion == "success"
    val finished: Boolean get() = status == "completed"
}

@Serializable
data class WorkflowRunsPage(
    @SerialName("total_count") val totalCount: Int = 0,
    val artifacts: List<Artifact> = emptyList(),
    @SerialName("workflow_runs") val workflowRuns: List<WorkflowRun> = emptyList(),
)

@Serializable
data class Artifact(
    val id: Long,
    val name: String,
    @SerialName("size_in_bytes") val sizeInBytes: Long = 0,
    val expired: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ArtifactsPage(
    @SerialName("total_count") val totalCount: Int = 0,
    val artifacts: List<Artifact> = emptyList(),
)

@Serializable
data class JobStep(
    val name: String? = null,
    val status: String? = null,
    val conclusion: String? = null,
    val number: Int? = null,
)

@Serializable
data class Job(
    val id: Long,
    val name: String? = null,
    val status: String? = null,
    val conclusion: String? = null,
    val steps: List<JobStep> = emptyList(),
)

@Serializable
data class JobsPage(
    @SerialName("total_count") val totalCount: Int = 0,
    val jobs: List<Job> = emptyList(),
)

@Serializable
data class Workflow(
    val id: Long,
    val name: String,
    val path: String,
    val state: String? = null,
)

@Serializable
data class WorkflowsPage(
    @SerialName("total_count") val totalCount: Int = 0,
    val workflows: List<Workflow> = emptyList(),
)

/**
 * A dispatch result. The API answers a workflow dispatch with 204 and no body, so
 * the run has to be found afterwards by listing recent runs and matching one that
 * started at or after the dispatch. That is why `dispatchedAt` is carried.
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
            status != "completed" && status in setOf("queued", "waiting", "requested", "pending") -> Queued
            status != "completed" -> Running
            conclusion == "success" -> Succeeded
            conclusion == "cancelled" -> Cancelled
            conclusion == null -> Unknown
            else -> Failed
        }
    }
}
