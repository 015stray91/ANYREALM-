package com.anyrealm.builder.data

/**
 * Watch rules, kept free of Android and of the network so they can be unit-tested
 * on the JVM.
 *
 * The reason these are separated out: every one of them is a rule that a front end
 * gets wrong in a way that looks like a bug in the build.
 *
 *   - `status == "completed"` does not mean the build worked. GitHub uses it for
 *     failures too, so `succeeded` checks the conclusion.
 *   - a failed run has no artefacts, so trying to download one reports a 404 that
 *     hides the real reason. `fetchDecision` refuses before the request.
 *   - polling forever looks like a hang. The budget is finite and says so.
 */
object WatchRules {

    /** 15 s between polls, 80 polls: about 20 minutes. */
    const val POLL_INTERVAL_MS = 15_000L
    const val MAX_POLLS = 80

    /** Choose the artefact an edition produces, falling back to the largest. */
    fun chooseArtifact(edition: String, artifacts: List<Artifact>): Artifact? {
        if (artifacts.isEmpty()) return null
        // Expired artefacts can be listed but not downloaded, so they are excluded
        // rather than picked and then failing.
        val usable = artifacts.filterNot { it.expired }
        if (usable.isEmpty()) return null

        // Patterns are tried in priority order, most specific first. A single
        // alternation is not enough: `logs.zip` also ends in `.zip`, so an edition
        // whose pattern includes a bare `.zip$` will pick a log bundle over the
        // kernel archive whenever the log bundle happens to be listed first.
        for (pattern in patternsFor(edition)) {
            usable.firstOrNull { pattern.containsMatchIn(it.name) }?.let { return it }
        }
        return usable.maxByOrNull { it.sizeInBytes }
    }

    private fun patternsFor(edition: String): List<Regex> = when (edition) {
        "desktop_iso" -> listOf(
            Regex("\\.iso$", RegexOption.IGNORE_CASE),
            Regex("\\biso\\b", RegexOption.IGNORE_CASE),
        )
        "mobile_kernel" -> listOf(
            Regex("(anykernel|\\bkernel\\b)", RegexOption.IGNORE_CASE),
            Regex("\\.zip$", RegexOption.IGNORE_CASE),
        )
        "rom" -> listOf(
            Regex("\\brom\\b", RegexOption.IGNORE_CASE),
            Regex("\\.zip$", RegexOption.IGNORE_CASE),
        )
        else -> emptyList()
    }

    /**
     * Progress as 0..100 from the job steps.
     *
     * Capped at 99 while running: 100 is reserved for an actual completion, so a bar
     * never looks finished for a run that has not finished.
     */
    fun progress(phase: RunPhase, jobs: List<Job>): Int {
        if (phase == RunPhase.Succeeded) return 100
        if (phase != RunPhase.Running) return 0
        val steps = jobs.flatMap { it.steps }
        if (steps.isEmpty()) return 0
        val done = steps.count { it.status == "completed" }
        return ((done.toFloat() / steps.size) * 100).toInt().coerceIn(1, 99)
    }

    /** Whether polling should continue, and why not when it should stop. */
    fun keepPolling(phase: RunPhase, polls: Int, error: String?): Pair<Boolean, String?> {
        if (error != null) return false to error
        if (phase.isTerminal) return false to null
        if (polls >= MAX_POLLS) {
            val minutes = (MAX_POLLS * POLL_INTERVAL_MS) / 60_000
            return false to "gave up after $MAX_POLLS polls (~$minutes min). The build may still be queued."
        }
        return true to null
    }

    /**
     * Whether a completed run should be downloaded.
     *
     * Returns the artefact to fetch, or a reason there is nothing to fetch. The
     * caller must not treat `null` here as retryable: a failed run stays failed.
     */
    fun fetchDecision(
        phase: RunPhase,
        artifacts: List<Artifact>,
        edition: String,
    ): FetchDecision {
        return when (phase) {
            RunPhase.Running, RunPhase.Queued -> FetchDecision(false, "still running", null)
            RunPhase.Succeeded -> {
                val pick = chooseArtifact(edition, artifacts)
                if (pick == null) {
                    FetchDecision(false, "the successful run uploaded no usable artefact", null)
                } else {
                    FetchDecision(true, pick.name, pick)
                }
            }
            RunPhase.Failed -> FetchDecision(false, "the build failed, so nothing was produced", null)
            RunPhase.Cancelled -> FetchDecision(false, "the build was cancelled", null)
            RunPhase.TimedOut -> FetchDecision(false, "the build timed out", null)
            RunPhase.Unknown -> FetchDecision(false, "the run state could not be read", null)
        }
    }

    data class FetchDecision(val fetch: Boolean, val reason: String, val artifact: Artifact?)
}

/** A run is terminal once it will not change again. */
val RunPhase.isTerminal: Boolean
    get() = this == RunPhase.Succeeded || this == RunPhase.Failed ||
        this == RunPhase.Cancelled || this == RunPhase.TimedOut

/** The line a UI shows for a phase, without the UI having to write a switch. */
fun RunPhase.describe(progress: Int = 0): String = when (this) {
    RunPhase.Queued -> "queued"
    RunPhase.Running -> "building — $progress%"
    RunPhase.Succeeded -> "succeeded"
    RunPhase.Failed -> "failed"
    RunPhase.Cancelled -> "cancelled"
    RunPhase.TimedOut -> "timed out"
    RunPhase.Unknown -> "unknown"
}
