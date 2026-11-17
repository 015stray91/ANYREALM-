package com.anyrealm.builder.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * One palette, dark by default.
 *
 * The builder shows kernel config keys, patch series names and byte offsets; those
 * are read for long stretches, so the contrast is deliberately high and the accent
 * is reserved for the one thing that matters at a time (the next step to answer).
 * It is not themed per Android version because a builder that changes appearance
 * between devices makes screenshots and bug reports harder to compare.
 */
private val Dark = darkColorScheme(
    primary = Color(0xFF7DD3FC),
    onPrimary = Color(0xFF04202E),
    primaryContainer = Color(0xFF12384B),
    onPrimaryContainer = Color(0xFFCDEBFA),
    secondary = Color(0xFFA7F3D0),
    onSecondary = Color(0xFF052E22),
    tertiary = Color(0xFFFCD34D),
    onTertiary = Color(0xFF2A1E00),
    background = Color(0xFF0B1120),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF121A2B),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1C2638),
    onSurfaceVariant = Color(0xFF9FB0C8),
    error = Color(0xFFFCA5A5),
    onError = Color(0xFF3B0A0A),
    errorContainer = Color(0xFF4A1414),
    onErrorContainer = Color(0xFFFECACA),
    outline = Color(0xFF34405A),
)

private val Light = lightColorScheme(
    primary = Color(0xFF0369A1),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0F2FE),
    onPrimaryContainer = Color(0xFF062B3F),
    secondary = Color(0xFF047857),
    tertiary = Color(0xFF92600A),
    background = Color(0xFFF8FAFC),
    onBackground = Color(0xFF0F172A),
    surface = Color.White,
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFEDF2F7),
    onSurfaceVariant = Color(0xFF44536B),
    error = Color(0xFFB91C1C),
    outline = Color(0xFFCBD5E1),
)

@Composable
fun AnyRealmTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (dark) Dark else Light,
        content = content,
    )
}
