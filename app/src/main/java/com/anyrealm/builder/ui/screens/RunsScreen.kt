package com.anyrealm.builder.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.anyrealm.builder.data.RunPhase
import com.anyrealm.builder.data.WorkflowRun
import com.anyrealm.builder.ui.AnyRealmViewModel
import com.anyrealm.builder.ui.components.PhaseBadge

/**
 * Recent runs, so an already-running build can be picked up.
 *
 * This exists because a dispatch is not always made from the phone: a build started
 * on a desktop, or a build that was already queued when the app opened, still needs
 * its artefact fetched. Re-attaching by run id is exactly what that needs.
 */
@Composable
fun RunsScreen(vm: AnyRealmViewModel, state: AnyRealmViewModel.UiState) {
    LaunchedEffect(state.token) {
        if (state.runs.isEmpty() && state.token.isNotBlank() && !state.busy) vm.loadRuns()
    }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${state.owner}/${state.repo}",
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                )
                Button(onClick = { vm.loadRuns() }, enabled = !state.busy && state.token.isNotBlank()) {
                    Text(if (state.busy) "Loading…" else "Refresh")
                }
            }
        }
        if (state.runs.isEmpty()) {
            item {
                Text(
                    if (state.token.isBlank()) "Add a token on the Settings tab to list runs."
                    else "No runs listed. A dispatch makes one appear within a few seconds.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(state.runs) { run -> RunRow(run, state, vm) }
    }
}

@Composable
private fun RunRow(run: WorkflowRun, state: AnyRealmViewModel.UiState, vm: AnyRealmViewModel) {
    val phase = RunPhase.of(run.status, run.conclusion)
    val isCurrent = state.run?.id == run.id
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isCurrent) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "#${run.id} ${run.name ?: ""}".trim(),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                PhaseBadge(phase, 0, false)
            }
            Text(
                "${run.headBranch ?: "?"} · ${run.createdAt ?: ""}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
            if (!run.finished) {
                Button(
                    onClick = { vm.attachToRun(run) },
                    modifier = Modifier.padding(top = 6.dp),
                    enabled = !state.watching,
                ) { Text(if (isCurrent && state.watching) "watching" else "watch this run") }
            } else if (phase == RunPhase.Succeeded) {
                Button(
                    onClick = { vm.attachToRun(run) },
                    modifier = Modifier.padding(top = 6.dp),
                    enabled = !state.watching,
                ) { Text("load its artefacts") }
            }
        }
    }
}
