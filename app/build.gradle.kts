plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The APK is a thin local front end to this repo's pipeline. It does not build
// anything itself: it dispatches a workflow, watches the run, and saves the
// artefact. That is why it needs no NDK, no AOSP tree and no native toolchain --
// only the GitHub API and the network.
val repoOwner = providers.gradleProperty("ANYREALM_REPO_OWNER")
    .orElse(providers.environmentVariable("ANYREALM_REPO_OWNER"))
    .orElse("015stray91")
val repoName = providers.gradleProperty("ANYREALM_REPO_NAME")
    .orElse(providers.environmentVariable("ANYREALM_REPO_NAME"))
    .orElse("ANYREALM-")

val appVersionCode = 1
val appVersionName = "0.1.0"

val releaseStoreFile = providers.gradleProperty("ANYREALM_RELEASE_STORE_FILE")
    .orElse(providers.environmentVariable("ANYREALM_RELEASE_STORE_FILE"))
val releaseStorePassword = providers.gradleProperty("ANYREALM_RELEASE_STORE_PASSWORD")
    .orElse(providers.environmentVariable("ANYREALM_RELEASE_STORE_PASSWORD"))
val releaseKeyAlias = providers.gradleProperty("ANYREALM_RELEASE_KEY_ALIAS")
    .orElse(providers.environmentVariable("ANYREALM_RELEASE_KEY_ALIAS"))
val releaseKeyPassword = providers.gradleProperty("ANYREALM_RELEASE_KEY_PASSWORD")
    .orElse(providers.environmentVariable("ANYREALM_RELEASE_KEY_PASSWORD"))

// A release build only exists when signing is configured; otherwise the APK is
// debug-signed and can still be side-loaded. Failing the build for a missing
// keystore would make a first run impossible.
val hasReleaseSigning = !releaseStoreFile.orNull.isNullOrBlank() &&
    !releaseStorePassword.orNull.isNullOrBlank() &&
    !releaseKeyAlias.orNull.isNullOrBlank() &&
    !releaseKeyPassword.orNull.isNullOrBlank()

android {
    namespace = "com.anyrealm.builder"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.anyrealm.builder"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        buildConfigField("String", "REPO_OWNER", "\"${repoOwner.get()}\"")
        buildConfigField("String", "REPO_NAME", "\"${repoName.get()}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    val composeBom = platform(libs.androidx.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)

    debugImplementation(libs.androidx.compose.ui.tooling)
    testImplementation(libs.junit)
}
