package com.anyrealm.builder.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.anyrealm.builder.BuildConfig
import com.anyrealm.builder.data.Artifact
import com.anyrealm.builder.data.Dispatched
import com.anyrealm.builder.data.GitHubClient
import com.anyrealm.builder.data.Job
import com.anyrealm.builder.data.RunPhase
import com.anyrealm.builder.data.Settings
import com.anyrealm.builder.data.WatchRules
import com.anyrealm.builder.data.WorkflowRun
import com.anyrealm.builder.data.describe
import com.anyrealm.builder.data.isTerminal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job as CoroutineJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * One view model for the whole app.
 *
 * The APK has exactly one job: send a dispatch, watch the run, save the artefact.
 * Splitting that across several view models would mean several places holding the
 * run id, and the run id is the only state that matters -- lose it and the watch
 * cannot be resumed.
 *
 * Everything network-bound runs on Dispatchers.IO. The UI only ever reads `state`.
 */
class AnyRealmViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val token: String = "",
        val owner: String = BuildConfig.REPO_OWNER,
        val repo: String = BuildConfig.REPO_NAME,
        val workflow: String = "",
        val edition: String = "desktop_iso",
        val workflows: List<String> = emptyList(),
        val runs: List<WorkflowRun> = emptyList(),
        val run: WorkflowRun? = null,
        val phase: RunPhase = RunPhase.Unknown,
        val progress: Int = 0,
        val polls: Int = 0,
        val artifacts: List<Artifact> = emptyList(),
        val artifact: Artifact? = null,
        val savedTo: String? = null,
        val downloadedBytes: Long = 0,
        val downloading: Boolean = false,
        val busy: Boolean = false,
        val watching: Boolean = false,
        val error: String? = null,
        val note: String? = null,
        val loaded: Boolean = false,
    ) {
        val canDispatch: Boolean
            get() = token.isNotBlank() && owner.isNotBlank() && repo.isNotBlank() && workflow.isNotBlank()
        val canWatch: Boolean get() = token.isNotBlank() && run != null
        val line: String
            get() = when {
                phase == RunPhase.Unknown -> "no run selected"
                else -> phase.describe(progress)
            }
    }

    private val settings = Settings(app)
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var watchJob: CoroutineJob? = null

    init {
        viewModelScope.launch {
            val snap = settings.current()
            _state.update {
                it.copy(
                    token = snap.token.orEmpty(),
                    owner = snap.owner ?: BuildConfig.REPO_OWNER,
                    repo = snap.repo ?: BuildConfig.REPO_NAME,
                    workflow = snap.workflow.orEmpty(),
                    edition = snap.effectiveEdition,
                    loaded = true,
                )
            }
            // A saved workflow means the repo coordinates are already known, so the
            // workflow list is worth loading at start rather than on first tap.
            if (snap.token.isNullOrBlank().not() && snap.repo.isNullOrBlank().not()) {
                refreshWorkflows()
            }
        }
    }

    private fun clientOrNull(): GitHubClient? =
        _state.value.token.takeIf { it.isNotBlank() }?.let { GitHubClient(it) }

    private fun fail(message: String) {
        _state.update { it.copy(busy = false, error = message) }
    }

    /* ---------------------------------------------------------------- settings */

    fun setToken(value: String) {
        _state.update { it.copy(token = value) }
    }

    fun setOwner(value: String) {
        _state.update { it.copy(owner = value) }
    }

    fun setRepo(value: String) {
        _state.update { it.copy(repo = value) }
    }

    fun setWorkflow(value: String) {
        _state.update { it.copy(workflow = value) }
    }

    fun setEdition(value: String) {
        _state.update { it.copy(edition = value) }
    }

    fun saveSettings() {
        val s = _state.value
        viewModelScope.launch {
            settings.setToken(s.token)
            settings.setRepo(s.owner, s.repo)
            settings.setWorkflow(s.workflow)
            settings.setEdition(s.edition)
            _state.update { it.copy(note = "saved") }
        }
    }

    fun dismissMessages() {
        _state.update { it.copy(error = null, note = null) }
    }

    /* --------------------------------------------------------------- workflows */

    fun refreshWorkflows() {
        val c = clientOrNull() ?: return fail("add a token first")
        val s = _state.value
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val wfs = withContext(Dispatchers.IO) { c.listWorkflows(s.owner, s.repo) }
                _state.update { st ->
                    st.copy(
                        busy = false,
                        workflows = wfs.map { it.path },
                        // Only adopt a default when the user has not chosen one: this
                        // is a convenience, not a silent override of their choice.
                        workflow = st.workflow.ifBlank { wfs.firstOrNull()?.path.orEmpty() },
                    )
                }
            } catch (e: Exception) {
                fail(e.message ?: "could not list workflows")
            }
        }
    }

    fun loadRuns() {
        val c = clientOrNull() ?: return fail("add a token first")
        val s = _state.value
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val runs = withContext(Dispatchers.IO) { c.listRuns(s.owner, s.repo) }
                _state.update { it.copy(busy = false, runs = runs) }
            } catch (e: Exception) {
                fail(e.message ?: "could not list runs")
            }
        }
    }

    /* ---------------------------------------------------------------- dispatch */

    fun dispatch() {
        val c = clientOrNull() ?: return fail("add a token first")
        val s = _state.value
        if (s.workflow.isBlank()) return fail("choose a workflow first")
        _state.update {
            it.copy(busy = true, error = null, note = null, artifacts = emptyList(), artifact = null, savedTo = null)
        }
        viewModelScope.launch {
            try {
                val d = withContext(Dispatchers.IO) {
                    c.dispatch(s.owner, s.repo, s.workflow, "main")
                }
                _state.update {
                    it.copy(
                        busy = false,
                        note = if (d.run != null) "dispatched; watching run ${d.run.id}" else "dispatched; the run is not listed yet",
                        run = d.run,
                        phase = if (d.run != null) RunPhase.Queued else RunPhase.Unknown,
                        polls = 0,
                        progress = 0,
                    )
                }
                if (d.run != null) startWatch(d.run.id)
            } catch (e: Exception) {
                fail(e.message ?: "dispatch failed")
            }
        }
    }

    /* ------------------------------------------------------------------- watch */

    fun attachToRun(run: WorkflowRun) {
        _state.update { it.copy(run = run, phase = RunPhase.of(run.status, run.conclusion), polls = 0) }
        startWatch(run.id)
    }

    fun stopWatch() {
        watchJob?.cancel()
        watchJob = null
        _state.update { it.copy(watching = false) }
    }

    /**
     * Poll until the run reaches a conclusion or the budget runs out.
     *
     * The stopping rules come from WatchRules so that they are the same ones the
     * desktop shell uses; this loop only carries them out. A transient HTTP error
     * does not end the watch -- GitHub returns 502s -- but it is surfaced, because
     * a silent retry loop looks identical to a stuck build.
     */
    private fun startWatch(runId: Long) {
        val c = clientOrNull() ?: return fail("add a token first")
        watchJob?.cancel()
        watchJob = viewModelScope.launch {
            _state.update { it.copy(watching = true, error = null) }
            var polls = 0
            var lastError: String? = null
            while (true) {
                val s = _state.value
                val phase = s.phase
                val (keep, reason) = WatchRules.keepPolling(phase, polls, null)
                if (!keep) {
                    if (reason != null) _state.update { it.copy(error = reason) }
                    break
                }
                delay(WatchRules.POLL_INTERVAL_MS)

                try {
                    val run = withContext(Dispatchers.IO) { c.getRun(s.owner, s.repo, runId) }
                    polls += 1
                    val nextPhase = RunPhase.of(run.status, run.conclusion)
                    var progress = 0
                    if (nextPhase == RunPhase.Running || nextPhase == RunPhase.Queued) {
                        val jobs: List<Job> = withContext(Dispatchers.IO) { c.listJobs(s.owner, s.repo, runId) }
                        progress = WatchRules.progress(nextPhase, jobs)
                    }
                    _state.update {
                        it.copy(run = run, phase = nextPhase, progress = progress, polls = polls, error = null)
                    }
                    lastError = null

                    if (nextPhase.isTerminal) {
                        if (nextPhase == RunPhase.Succeeded) {
                            val arts = withContext(Dispatchers.IO) { c.listArtifacts(s.owner, s.repo, runId) }
                            val pick = WatchRules.chooseArtifact(s.edition, arts)
                            val decision = WatchRules.fetchDecision(nextPhase, arts, s.edition)
                            _state.update {
                                it.copy(artifacts = arts, artifact = pick, note = decision.reason)
                            }
                        } else {
                            _state.update { it.copy(note = "run concluded ${run.conclusion}; nothing to fetch") }
                        }
                        break
                    }
                } catch (e: Exception) {
                    // Count the poll anyway: a permanently broken token must not loop.
                    polls += 1
                    lastError = e.message
                    _state.update { it.copy(polls = polls, error = e.message ?: "poll failed") }
                }
            }
            _state.update { it.copy(watching = false) }
            if (lastError != null && _state.value.error == null) {
                _state.update { it.copy(error = lastError) }
            }
        }
    }

    /* ---------------------------------------------------------------- download */

    /** Override which artefact the download should take. */
    fun chooseArtifact(art: Artifact) {
        _state.update { it.copy(artifact = art) }
    }

    fun download() {
        val c = clientOrNull() ?: return fail("add a token first")
        val s = _state.value
        val art = s.artifact ?: s.artifacts.firstOrNull()
        if (art == null) return fail("no artefact to fetch yet")
        if (s.phase != RunPhase.Succeeded) return fail("only a successful run has an artefact")

        // getApplication() is itself the Context, so its filesDir is used directly;
        // reading `filesDir` off the ViewModel does not resolve.
        val app = getApplication<Application>()
        val dest = File(app.getExternalFilesDir(null) ?: app.filesDir, "artifacts")
        _state.update { it.copy(downloading = true, error = null, downloadedBytes = 0, savedTo = null) }
        viewModelScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    c.downloadArtifact(s.owner, s.repo, art, dest) { read, _ ->
                        _state.update { it.copy(downloadedBytes = read) }
                    }
                }
                _state.update {
                    it.copy(
                        downloading = false,
                        savedTo = file.absolutePath,
                        note = "saved ${file.name}",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(downloading = false, error = e.message ?: "download failed")
                }
            }
        }
    }
}
