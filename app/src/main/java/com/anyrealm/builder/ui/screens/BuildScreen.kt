package com.anyrealm.builder.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.anyrealm.builder.data.Artifact
import com.anyrealm.builder.data.RunPhase
import com.anyrealm.builder.ui.AnyRealmViewModel
import com.anyrealm.builder.ui.components.FactRow
import com.anyrealm.builder.ui.components.PhaseBadge
import com.anyrealm.builder.ui.components.Section
import com.anyrealm.builder.ui.components.humanBytes

/**
 * The build screen: dispatch, watch, save.
 *
 * The three steps are in one column in the order they happen, because the app's
 * whole value is that a user does not have to understand Actions to use it. Each
 * step is disabled until the previous one makes sense, and the reason is written
 * next to it rather than being a greyed-out button with no explanation.
 */
@Composable
fun BuildScreen(vm: AnyRealmViewModel, state: AnyRealmViewModel.UiState) {
    Column(
        modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Section(
            "1. Dispatch",
            "${state.owner}/${state.repo} · ${state.workflow.ifBlank { "no workflow chosen" }}",
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { vm.dispatch() },
                    enabled = state.canDispatch && !state.busy && !state.watching,
                ) { Text(if (state.busy) "Dispatching…" else "Start build") }
                OutlinedButton(
                    onClick = { vm.loadRuns() },
                    enabled = !state.busy && state.token.isNotBlank(),
                ) { Text("Recent runs") }
            }
            if (!state.canDispatch) {
                Text(
                    "A token, owner, repo and workflow are needed before a build can start. " +
                        "Set them on the Settings tab.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }

        val run = state.run
        Section(
            "2. Watch",
            if (run == null) "No run yet. Starting a build picks up its run automatically."
            else "Run ${run.id} · ${run.name ?: state.workflow}",
        ) {
            if (run == null) {
                Text(
                    "This build is dispatched on a branch and runs in Actions. It is watched " +
                        "here every ${15} s, and stops on its own when it finishes.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    PhaseBadge(state.phase, state.progress, state.watching)
                    Text(
                        "${state.polls} poll(s)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                FactRow("status", run.status ?: "-")
                FactRow("conclusion", run.conclusion ?: "-")
                FactRow("branch", run.headBranch ?: "-")
                run.htmlUrl?.let { url ->
                    TextButton(onClick = { openUrl(vm, url) }) { Text("Open the run in a browser") }
                }
                if (state.watching) {
                    TextButton(onClick = { vm.stopWatch() }) { Text("Stop watching") }
                } else if (run.status != "completed") {
                    TextButton(onClick = { vm.attachToRun(run) }) { Text("Resume watching this run") }
                }
            }
        }

        Section(
            "3. Save the artefact",
            when (state.phase) {
                RunPhase.Succeeded -> "The run succeeded. Pick which artefact to keep."
                RunPhase.Failed, RunPhase.Cancelled, RunPhase.TimedOut ->
                    "The run did not succeed, so there is nothing to save. A finished run is not " +
                        "the same thing as a successful one."
                else -> "Available once the run reaches a successful conclusion."
            },
        ) {
            if (state.artifacts.isEmpty()) {
                Text(
                    "No artefacts yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                state.artifacts.forEach { art ->
                    ArtifactRow(
                        art = art,
                        selected = (state.artifact?.id ?: state.artifacts.first().id) == art.id,
                        enabled = state.phase == RunPhase.Succeeded && !state.downloading,
                        onClick = { vm.chooseArtifact(art) },
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = { vm.download() },
                        enabled = state.phase == RunPhase.Succeeded && !state.downloading,
                    ) {
                        Text(if (state.downloading) "Downloading…" else "Download")
                    }
                }
                if (state.downloading) {
                    Text(
                        "Received ${humanBytes(state.downloadedBytes)}",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                state.savedTo?.let { path ->
                    Text(
                        "Saved to $path",
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    Text(
                        "This is the phone's app storage. Copy it to a computer before flashing: " +
                            "the kernel zip or ISO is the input to fastboot or a USB write.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ArtifactRow(art: Artifact, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f)) {
                Text(art.name, style = MaterialTheme.typography.bodySmall)
                Text(
                    "${humanBytes(art.sizeInBytes)}${if (art.expired) " · expired" else ""}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onClick, enabled = enabled) {
                Text(if (selected) "chosen" else "choose")
            }
        }
    }
}

/** Open a URL outside the app. Kept here so the screen needs no Context import. */
private fun openUrl(vm: AnyRealmViewModel, url: String) {
    val ctx = vm.getApplication<android.app.Application>()
    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
}
