// Root build file. Plugins are declared but not applied here; the app module
// applies them, which is what keeps this file empty of configuration.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
