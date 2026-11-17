# Gson reads model fields reflectively, so R8 must not rename or remove them. Without
# these rules the release APK parses every response into an object with all-null
# fields, which looks like the API returning nothing rather than like a build error.
-keep class com.anyrealm.builder.data.** { *; }
-keepattributes Signature
-keepattributes *Annotation*

# OkHttp reaches for optional platform providers that are absent on Android.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# kotlinx.coroutines uses reflection for its debug stack traces only.
-dontwarn kotlinx.coroutines.**
