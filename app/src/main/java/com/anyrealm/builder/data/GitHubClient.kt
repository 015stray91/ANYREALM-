package com.anyrealm.builder.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The GitHub client.
 *
 * This is the whole point of the app: dispatch a workflow, watch the run, fetch the
 * artefact. It uses the REST API directly rather than the AnyRealm server, because
 * the phone cannot reach a server running on the user's desktop -- being a local
 * front end to a remote pipeline, speaking to the API itself is the only thing that
 * works.
 *
 * Two rules are enforced here rather than in the UI:
 *
 *   - a run that completed with `failure` is not a success. `WorkflowRun.succeeded`
 *     is used everywhere instead of comparing `status` alone, because GitHub reports
 *     status=completed for a failed run too.
 *   - a download never overwrites a previous one. Builds produce the same file name
 *     every time, so a second fetch of the same artefact would otherwise silently
 *     replace the first.
 */
class GitHubClient(private val token: String) {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        // Downloads can be large; the write is local but the read is over the network.
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun request(path: String): Request =
        Request.Builder()
            .url("https://api.github.com$path")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "anyrealm-builder-apk")
            .build()

    private fun <T> get(path: String, decode: (String) -> T): T {
        http.newCall(request(path)).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IOException("HTTP ${res.code} for $path: ${body.take(300)}")
            }
            return decode(body)
        }
    }

    fun listWorkflows(owner: String, repo: String): List<Workflow> {
        val page = get("/repos/$owner/$repo/actions/workflows") { body ->
            json.decodeFromString<WorkflowsPage>(body)
        }
        return page.workflows
    }

    fun listRuns(owner: String, repo: String, perPage: Int = 20): List<WorkflowRun> {
        val page = get("/repos/$owner/$repo/actions/runs?per_page=$perPage") { body ->
            json.decodeFromString<WorkflowRunsPage>(body)
        }
        return page.workflowRuns
    }

    fun getRun(owner: String, repo: String, runId: Long): WorkflowRun =
        get("/repos/$owner/$repo/actions/runs/$runId") { body ->
            json.decodeFromString<WorkflowRun>(body)
        }

    fun listJobs(owner: String, repo: String, runId: Long): List<Job> {
        val page = get("/repos/$owner/$repo/actions/runs/$runId/jobs") { body ->
            json.decodeFromString<JobsPage>(body)
        }
        return page.jobs
    }

    fun listArtifacts(owner: String, repo: String, runId: Long): List<Artifact> {
        val page = get("/repos/$owner/$repo/actions/runs/$runId/artifacts") { body ->
            json.decodeFromString<ArtifactsPage>(body)
        }
        return page.artifacts
    }

    /**
     * Dispatch a workflow.
     *
     * GitHub answers 204 with no body, so the created run is found by listing runs
     * and taking the newest one for this workflow that started after the dispatch.
     * Returning null for the run is normal and not an error: the dispatch worked,
     * the run just is not visible yet.
     */
    fun dispatch(
        owner: String,
        repo: String,
        workflowFile: String,
        ref: String,
        inputs: Map<String, String> = emptyMap(),
    ): Dispatched {
        val now = System.currentTimeMillis() / 1000
        val payload = buildJsonObject {
            put("ref", ref)
            if (inputs.isNotEmpty()) {
                put("inputs", JsonObject(inputs.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }))
            }
        }
        val req = request("/repos/$owner/$repo/actions/workflows/$workflowFile/dispatches")
            .newBuilder()
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                val body = res.body?.string().orEmpty()
                throw IOException("dispatch failed: HTTP ${res.code} ${body.take(300)}")
            }
        }

        // Best-effort run lookup, so the UI can start watching immediately.
        val run = try {
            Thread.sleep(1500)
            listRuns(owner, repo, perPage = 10).firstOrNull { r ->
                r.workflowId != null &&
                    r.createdAt != null &&
                    (r.name?.isNotBlank() == true) &&
                    runMatchesWorkflow(r, workflowFile) &&
                    epochOf(r.createdAt) >= now - 5
            }
        } catch (_: Exception) {
            null
        }
        return Dispatched(workflowFile, ref, now, run)
    }

    /** A run carries the workflow's name; the file is what we dispatched with. */
    private fun runMatchesWorkflow(run: WorkflowRun, workflowFile: String): Boolean {
        val stem = workflowFile.substringAfterLast('/').removeSuffix(".yml").removeSuffix(".yaml")
        return run.name?.contains(stem, ignoreCase = true) == true
    }

    private fun epochOf(iso: String): Long = try {
        java.time.Instant.parse(iso).epochSecond
    } catch (_: Exception) {
        0L
    }

    /**
     * Download an artefact zip and move the payload out of it.
     *
     * GitHub serves the artefact as a zip even when the artefact is one file, so the
     * result is a zip on disk either way. Unpacking here means the user gets the ISO
     * or the kernel zip directly rather than a zip-inside-a-zip.
     */
    fun downloadArtifact(
        owner: String,
        repo: String,
        artifact: Artifact,
        destDir: File,
        onProgress: (bytesRead: Long, total: Long) -> Unit = { _, _ -> },
    ): File {
        destDir.mkdirs()
        val req = request("/repos/$owner/$repo/actions/artifacts/${artifact.id}/zip")
        val tmp = File(destDir, "${artifact.name}-${System.currentTimeMillis()}.zip.part")

        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw IOException("download failed: HTTP ${res.code}")
            }
            val body = res.body ?: throw IOException("download failed: empty body")
            val total = body.contentLength()
            body.byteStream().use { input ->
                tmp.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    var read = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        read += n
                        onProgress(read, total)
                    }
                }
            }
        }

        // Rename before unpacking so a partial file is never mistaken for a complete one.
        val zip = File(destDir, "${artifact.name}-${System.currentTimeMillis()}.zip")
        tmp.renameTo(zip)
        return unpackOrKeep(zip, destDir)
    }

    /**
     * If the zip holds exactly one payload, move that out and delete the zip.
     * Otherwise keep the zip: a multi-file artefact is legitimately a bundle.
     */
    private fun unpackOrKeep(zip: File, destDir: File): File {
        return try {
            java.util.zip.ZipFile(zip).use { zf ->
                val entries = zf.entries().toList().filter { !it.isDirectory }
                if (entries.size != 1) return zip
                val entry = entries.first()
                // A nested directory prefix is normal: artefact zips wrap the payload.
                val name = entry.name.substringAfterLast('/')
                if (name.isBlank()) return zip
                val out = File(destDir, name)
                if (out.exists()) {
                    val ext = name.substringAfterLast('.', "")
                    val stem = if (ext.isEmpty()) name else name.removeSuffix(".$ext")
                    var candidate = File(destDir, if (ext.isEmpty()) "$stem-2" else "$stem-2.$ext")
                    var i = 2
                    while (candidate.exists()) {
                        i += 1
                        candidate = File(destDir, if (ext.isEmpty()) "$stem-$i" else "$stem-$i.$ext")
                    }
                    zf.getInputStream(entry).use { input ->
                        candidate.outputStream().use { output -> input.copyTo(output) }
                    }
                    zip.delete()
                    return candidate
                }
                zf.getInputStream(entry).use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
                zip.delete()
                out
            }
        } catch (_: Exception) {
            zip
        }
    }
}
