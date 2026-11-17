# kotlinx.serialization keeps its generated serializers in the companion objects;
# R8 needs to be told, or the JSON parsing silently fails at runtime.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.anyrealm.builder.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.anyrealm.builder.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.anyrealm.builder.data.**$$serializer { *; }

# OkHttp pulls in optional Conscrypt/BouncyCastle paths that are absent on Android.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
