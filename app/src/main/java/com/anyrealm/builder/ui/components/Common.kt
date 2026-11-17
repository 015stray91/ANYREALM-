package com.anyrealm.builder.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.anyrealm.builder.data.RunPhase
import com.anyrealm.builder.data.describe

/** A labelled value in a monospace face, for the technical half of the UI. */
@Composable
fun FactRow(label: String, value: String, mono: Boolean = true) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = if (mono) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            else MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
        )
    }
}

/** A section card. Used instead of dividers so long screens stay scannable. */
@Composable
fun Section(
    title: String,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 4.dp),
                )
            }
            Column(Modifier.padding(top = 6.dp)) { content() }
        }
    }
}

/**
 * The run's state, in the colour that matters.
 *
 * A failure is red and states the conclusion word GitHub gave, because "completed"
 * on its own is how a front end ends up claiming a build that never produced a file.
 */
@Composable
fun PhaseBadge(phase: RunPhase, progress: Int, watching: Boolean) {
    val color = when (phase) {
        RunPhase.Succeeded -> MaterialTheme.colorScheme.secondary
        RunPhase.Failed, RunPhase.Cancelled, RunPhase.TimedOut -> MaterialTheme.colorScheme.error
        RunPhase.Running, RunPhase.Queued -> MaterialTheme.colorScheme.primary
        RunPhase.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (watching && (phase == RunPhase.Running || phase == RunPhase.Queued)) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = color,
            )
            Text(
                text = "  " + phase.describe(progress),
                color = color,
                style = MaterialTheme.typography.labelLarge,
            )
        } else {
            Text(phase.describe(progress), color = color, style = MaterialTheme.typography.labelLarge)
        }
    }
    if (phase == RunPhase.Running && progress > 0) {
        LinearProgressIndicator(
            progress = { progress / 100f },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

/** Bytes as something a person can read, with no locale surprises. */
fun humanBytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.2f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
    bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
    else -> "$bytes B"
}
