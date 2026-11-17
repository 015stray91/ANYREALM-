package com.anyrealm.builder.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.anyrealm.builder.ui.AnyRealmViewModel
import com.anyrealm.builder.ui.components.Section

private val EDITIONS = listOf(
    "desktop_iso" to "Desktop ISO (x86_64)",
    "mobile_kernel" to "Mobile kernel (arm64)",
    "rom" to "ROM package",
)

/**
 * Settings: where the pipeline is, and what token can reach it.
 *
 * The token note is not boilerplate. An APK cannot keep a secret from a rooted
 * device, and a user dispatching builds with write access deserves to know that
 * rather than assume the app is a vault. `actions:write` on a fork is a real
 * permission, so the screen says what to grant and what not to.
 */
@Composable
fun SettingsScreen(vm: AnyRealmViewModel, state: AnyRealmViewModel.UiState) {
    var token by remember(state.token) { mutableStateOf(state.token) }
    var owner by remember(state.owner) { mutableStateOf(state.owner) }
    var repo by remember(state.repo) { mutableStateOf(state.repo) }
    var workflow by remember(state.workflow) { mutableStateOf(state.workflow) }
    var showToken by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Section(
            "Pipeline",
            "The repo this app dispatches in. It is a front end only -- the build happens in GitHub Actions.",
        ) {
            OutlinedTextField(
                value = owner,
                onValueChange = { owner = it; vm.setOwner(it) },
                label = { Text("Owner") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = repo,
                onValueChange = { repo = it; vm.setRepo(it) },
                label = { Text("Repository") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = workflow,
                onValueChange = { workflow = it; vm.setWorkflow(it) },
                label = { Text("Workflow file") },
                placeholder = { Text(".github/workflows/build.yml") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.workflows.isNotEmpty()) {
                Text(
                    "Workflows in this repo",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
                state.workflows.forEach { path ->
                    FilterChip(
                        selected = workflow == path,
                        onClick = { workflow = path; vm.setWorkflow(path) },
                        label = { Text(path.substringAfterLast('/')) },
                        modifier = Modifier.padding(end = 6.dp, top = 4.dp),
                    )
                }
            }
            Row(Modifier.padding(top = 8.dp)) {
                Button(onClick = { vm.refreshWorkflows() }, enabled = !state.busy) {
                    Text("List workflows")
                }
            }
        }

        Section(
            "Token",
            "A fine-grained personal access token with Actions: read and write on this one repo. Nothing else.",
        ) {
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; vm.setToken(it) },
                label = { Text("GitHub token") },
                singleLine = true,
                visualTransformation = if (showToken) androidx.compose.ui.text.input.VisualTransformation.None
                else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = showToken,
                    onClick = { showToken = !showToken },
                    label = { Text(if (showToken) "Hide" else "Show") },
                )
                Button(onClick = { vm.saveSettings() }) { Text("Save") }
            }
            Text(
                "This is stored in the app's private data, which is not a vault: a rooted phone " +
                    "can read it. Use a token scoped to this one repo, and revoke it when the app " +
                    "is not in use.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        Section(
            "Edition",
            "Which artefact a successful run should hand back. It is only a preference: a run that " +
                "uploads nothing matching still falls back to its largest artefact.",
        ) {
            EDITIONS.forEach { (id, label) ->
                FilterChip(
                    selected = state.edition == id,
                    onClick = { vm.setEdition(id) },
                    label = { Text(label) },
                    modifier = Modifier.padding(end = 6.dp, bottom = 4.dp),
                )
            }
        }
    }
}
