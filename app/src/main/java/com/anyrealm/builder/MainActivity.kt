package com.anyrealm.builder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.anyrealm.builder.ui.AnyRealmViewModel
import com.anyrealm.builder.ui.screens.BuildScreen
import com.anyrealm.builder.ui.screens.RunsScreen
import com.anyrealm.builder.ui.screens.SettingsScreen
import com.anyrealm.builder.ui.theme.AnyRealmTheme

/**
 * The whole app: three tabs over one view model.
 *
 * The tabs are Settings, Build, Runs, in that order, because that is the order a
 * first run needs them -- the pipeline has to be pointed somewhere before a build
 * can start. After the first run, Build is the only tab in use, which is why it is
 * the middle one and the app opens on it once settings exist.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AnyRealmTheme {
                val vm: AnyRealmViewModel = viewModel()
                val state by vm.state.collectAsStateWithLifecycle()
                AnyRealmApp(vm, state)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AnyRealmApp(vm: AnyRealmViewModel, state: AnyRealmViewModel.UiState) {
    // Start on Build when the app is already configured; otherwise Settings, so a
    // first run is not a screen of disabled buttons.
    var tab by rememberSaveable { mutableIntStateOf(if (state.loaded && state.canDispatch) 1 else 0) }
    // Once settings arrive asynchronously, move off Settings only if the user has not
    // already navigated themselves.
    val tabs = listOf("Settings", "Build", "Runs")
    val icons = listOf(Icons.Filled.Settings, Icons.Filled.Build, Icons.Filled.History)

    val message = state.error ?: state.note

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("AnyRealm Builder", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "local front end · ${state.line}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                tabs.forEachIndexed { i, label ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Icon(icons[i], contentDescription = label) },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            when (tab) {
                0 -> SettingsScreen(vm, state)
                1 -> BuildScreen(vm, state)
                else -> RunsScreen(vm, state)
            }
        }
    }

    if (message != null) {
        AlertDialog(
            onDismissRequest = { vm.dismissMessages() },
            title = { Text(if (state.error != null) "Something went wrong" else "Done") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { vm.dismissMessages() }) { Text("OK") }
            },
        )
    }
}
