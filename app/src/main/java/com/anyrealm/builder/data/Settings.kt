package com.anyrealm.builder.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "anyrealm")

/**
 * Settings, stored with DataStore.
 *
 * The token is a GitHub personal access token with `actions:write` and
 * `actions:read`. It is stored in the app's private DataStore file, which is only
 * readable by this app on a non-rooted device. That is the honest limit of what an
 * APK can offer: Android has no per-app secret vault that a rooted device cannot
 * read, so this is a convenience store, not a security boundary. The UI says so
 * rather than implying more.
 */
class Settings(private val context: Context) {

    private val tokenKey = stringPreferencesKey("github_token")
    private val ownerKey = stringPreferencesKey("repo_owner")
    private val repoKey = stringPreferencesKey("repo_name")
    private val workflowKey = stringPreferencesKey("workflow_file")
    private val editionKey = stringPreferencesKey("edition")

    val token: Flow<String?> = context.dataStore.data.map { it[tokenKey] }
    val owner: Flow<String?> = context.dataStore.data.map { it[ownerKey] }
    val repo: Flow<String?> = context.dataStore.data.map { it[repoKey] }
    val workflow: Flow<String?> = context.dataStore.data.map { it[workflowKey] }
    val edition: Flow<String?> = context.dataStore.data.map { it[editionKey] }

    suspend fun current(): Snapshot = Snapshot(
        token = token.first(),
        owner = owner.first(),
        repo = repo.first(),
        workflow = workflow.first(),
        edition = edition.first(),
    )

    suspend fun setToken(value: String?) = context.dataStore.edit {
        if (value.isNullOrBlank()) it.remove(tokenKey) else it[tokenKey] = value.trim()
    }

    suspend fun setRepo(owner: String, repo: String) = context.dataStore.edit {
        it[ownerKey] = owner.trim()
        it[repoKey] = repo.trim()
    }

    suspend fun setWorkflow(file: String) = context.dataStore.edit {
        if (file.isBlank()) it.remove(workflowKey) else it[workflowKey] = file.trim()
    }

    suspend fun setEdition(value: String) = context.dataStore.edit {
        it[editionKey] = value
    }

    data class Snapshot(
        val token: String?,
        val owner: String?,
        val repo: String?,
        val workflow: String?,
        val edition: String?,
    ) {
        /** Everything needed to dispatch is present. */
        val dispatchable: Boolean
            get() = !token.isNullOrBlank() && !owner.isNullOrBlank() &&
                !repo.isNullOrBlank() && !workflow.isNullOrBlank()

        val repoSlug: String get() = "${owner ?: ""}/${repo ?: ""}"
        val effectiveEdition: String get() = edition ?: "desktop_iso"
    }
}
