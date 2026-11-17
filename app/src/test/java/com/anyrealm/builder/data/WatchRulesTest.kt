package com.anyrealm.builder.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The watch rules, tested without Android or the network.
 *
 * These are the checks worth having a test for, because each one corresponds to a
 * way a front end lies to its user: claiming a failed build succeeded, trying to
 * download nothing, or spinning forever.
 */
class WatchRulesTest {

    /**
     * Build an artefact. The models are mutable Gson classes with no constructor
     * parameters, so this sets fields rather than using named arguments -- which is
     * also why the model classes cannot be `data class` and compared by value.
     */
    private fun art(name: String, size: Long = 1_000, expired: Boolean = false): Artifact =
        Artifact().apply {
            id = name.hashCode().toLong()
            this.name = name
            sizeInBytes = size
            this.expired = expired
        }

    @Test
    fun `completed with failure is not success`() {
        val phase = RunPhase.of("completed", "failure")
        assertEquals(RunPhase.Failed, phase)
        assertFalse(WatchRules.fetchDecision(phase, listOf(art("a.iso")), "desktop_iso").fetch)
    }

    @Test
    fun `completed with success fetches`() {
        val phase = RunPhase.of("completed", "success")
        assertEquals(RunPhase.Succeeded, phase)
        val d = WatchRules.fetchDecision(phase, listOf(art("AnyRealm.iso")), "desktop_iso")
        assertTrue(d.fetch)
        assertEquals("AnyRealm.iso", d.reason)
    }

    @Test
    fun `cancelled and timed out are terminal and fetch nothing`() {
        for (c in listOf("cancelled", "timed_out", "action_required")) {
            val phase = RunPhase.of("completed", c)
            assertTrue("$c should be terminal", phase.isTerminal)
            assertFalse(WatchRules.fetchDecision(phase, listOf(art("a.iso")), "desktop_iso").fetch)
        }
    }

    @Test
    fun `queued and running are not terminal`() {
        assertFalse(RunPhase.of("queued", null).isTerminal)
        assertFalse(RunPhase.of("in_progress", null).isTerminal)
        assertEquals(RunPhase.Queued, RunPhase.of("waiting", null))
    }

    @Test
    fun `desktop prefers the iso over a larger log bundle`() {
        val pick = WatchRules.chooseArtifact(
            "desktop_iso",
            listOf(art("logs.zip", 900_000_000), art("AnyRealm-NUKI-NURFS.iso", 5_000_000_000)),
        )
        assertEquals("AnyRealm-NUKI-NURFS.iso", pick?.name)
    }

    @Test
    fun `mobile prefers a kernel zip over a larger log bundle`() {
        val pick = WatchRules.chooseArtifact(
            "mobile_kernel",
            listOf(art("logs.zip", 900_000_000), art("AnyKernel3-kernel.zip", 10_000_000)),
        )
        assertEquals("AnyKernel3-kernel.zip", pick?.name)
    }

    @Test
    fun `expired artefacts are never chosen`() {
        assertNull(WatchRules.chooseArtifact("desktop_iso", listOf(art("stale.iso", expired = true))))
    }

    @Test
    fun `unknown edition falls back to the largest artefact`() {
        val pick = WatchRules.chooseArtifact(
            "something_else",
            listOf(art("small.bin", 10), art("big.bin", 1_000_000)),
        )
        assertEquals("big.bin", pick?.name)
    }

    @Test
    fun `progress never reports a finished bar before finishing`() {
        fun step(status: String) = JobStep().apply { this.status = status }
        fun job(vararg st: String) = Job().apply { id = 1; steps = st.map(::step) }

        val jobs = listOf(job("completed", "in_progress"))
        assertEquals(50, WatchRules.progress(RunPhase.Running, jobs))
        assertEquals(99, WatchRules.progress(RunPhase.Running, listOf(job("completed"))))
        assertEquals(100, WatchRules.progress(RunPhase.Succeeded, jobs))
        assertEquals(0, WatchRules.progress(RunPhase.Queued, jobs))
    }

    @Test
    fun `polling stops at the budget and says why`() {
        val (keep, reason) = WatchRules.keepPolling(RunPhase.Running, WatchRules.MAX_POLLS, null)
        assertFalse(keep)
        assertTrue(reason!!.contains("gave up"))
        assertTrue(WatchRules.keepPolling(RunPhase.Running, 3, null).first)
        assertFalse(WatchRules.keepPolling(RunPhase.Succeeded, 3, null).first)
    }

    @Test
    fun `the budget is about twenty minutes`() {
        val minutes = (WatchRules.MAX_POLLS * WatchRules.POLL_INTERVAL_MS) / 60_000
        assertEquals(20L, minutes)
    }
}
