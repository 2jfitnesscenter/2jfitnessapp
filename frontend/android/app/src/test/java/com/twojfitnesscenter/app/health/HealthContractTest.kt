// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM tests of the contract (no Android, no Health Connect): ./gradlew testDebugUnitTest */
class HealthContractTest {
    private val now = Instant.parse("2026-10-02T12:00:00Z")
    private val ms = { iso: String -> Instant.parse(iso).toEpochMilli() }

    @Test fun readAndWritePermissionSetsAreSeparateAndMinimal() {
        val read = HealthContract.requestedPermissions()
        assertEquals(4, read.size)
        assertTrue(read.all { it.startsWith("android.permission.health.READ_") })
        val write = HealthContract.requestedWritePermissions()
        // the session, and active calories only for a labelled 2J estimate; never distance or heart rate
        assertEquals(setOf("android.permission.health.WRITE_EXERCISE", "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED"), write)
        assertTrue(read.intersect(write).isEmpty())
        assertFalse(write.any { it.contains("DISTANCE") || it.contains("HEART") })
    }

    @Test fun grantedNamesAreTheWebNamesInStableOrder() {
        val rd = HealthContract.READ_PERMISSIONS
        assertEquals(listOf("workouts", "heartRate"), HealthContract.grantedNames(setOf(rd.getValue("heartRate"), rd.getValue("workouts"), "android.permission.CAMERA")))
        assertEquals(listOf("workouts", "steps"), HealthContract.grantedNames(setOf(rd.getValue("steps"), rd.getValue("workouts"))))
        assertEquals(emptyList<String>(), HealthContract.grantedNames(emptySet()))
        // a write grant never shows up as a read grant, and vice versa
        assertEquals(emptyList<String>(), HealthContract.grantedNames(HealthContract.requestedWritePermissions()))
        assertEquals(listOf("writeWorkouts", "writeActiveCalories"), HealthContract.grantedWriteNames(HealthContract.requestedWritePermissions() + rd.getValue("workouts")))
        assertEquals(listOf("writeWorkouts"), HealthContract.grantedWriteNames(setOf(HealthContract.WRITE_PERMISSIONS.getValue("writeWorkouts"))))
        assertEquals(emptyList<String>(), HealthContract.grantedWriteNames(HealthContract.requestedPermissions()))
    }

    @Test fun partialAndDeniedGrantsDecideWhatIsReadAndWhatIsAskedAgain() {
        val rd = HealthContract.READ_PERMISSIONS
        val onlyWorkouts = setOf(rd.getValue("workouts"))
        assertTrue(HealthContract.canReadWorkouts(onlyWorkouts))
        assertFalse(HealthContract.canReadCalories(onlyWorkouts))
        assertFalse(HealthContract.canReadHeartRate(onlyWorkouts))
        assertFalse(HealthContract.canReadSteps(onlyWorkouts))
        assertEquals(setOf(rd.getValue("activeCalories"), rd.getValue("heartRate"), rd.getValue("steps")), HealthContract.missingPermissions(onlyWorkouts))
        assertTrue(HealthContract.missingPermissions(HealthContract.requestedPermissions()).isEmpty())
        assertFalse(HealthContract.canReadWorkouts(setOf(rd.getValue("heartRate"), rd.getValue("activeCalories"))))
        assertFalse(HealthContract.canReadWorkouts(emptySet()))
        // writing needs its own grant, whatever is readable
        assertFalse(HealthContract.canWriteWorkouts(HealthContract.requestedPermissions()))
        assertTrue(HealthContract.canWriteWorkouts(HealthContract.requestedWritePermissions()))
        // energy has its own grant: the session alone does not allow writing an estimate
        assertFalse(HealthContract.canWriteEnergy(setOf(HealthContract.WRITE_PERMISSIONS.getValue("writeWorkouts"))))
        assertTrue(HealthContract.canWriteEnergy(HealthContract.requestedWritePermissions()))
        // The plugin must fail closed if write consent exists without read permission for dedupe.
        val writeOnlyEnergy = setOf(HealthContract.WRITE_PERMISSIONS.getValue("writeActiveCalories"))
        assertTrue(HealthContract.canWriteEnergy(writeOnlyEnergy))
        assertFalse(HealthContract.canReadCalories(writeOnlyEnergy))
        assertEquals(HealthContract.requestedWritePermissions(), HealthContract.missingWritePermissions(emptySet()))
        assertTrue(HealthContract.missingWritePermissions(HealthContract.requestedWritePermissions()).isEmpty())
    }

    @Test fun rangeIsBoundedToNinetyDaysAndNeverTheFuture() {
        val r = HealthContract.parseRange("2026-09-01T00:00:00Z", "2026-10-02T12:00:00Z", now)!!
        assertEquals(Instant.parse("2026-09-01T00:00:00Z"), r.start)
        val old = HealthContract.parseRange("2020-01-01T00:00:00Z", "2026-10-02T12:00:00Z", now)!!
        assertEquals(now.minusSeconds(90L * 86400), old.start)
        val future = HealthContract.parseRange("2026-10-01T00:00:00Z", "2030-01-01T00:00:00Z", now)!!
        assertEquals(now.plusSeconds(300), future.end)
    }

    @Test fun unusableRangesAreRefused() {
        assertNull(HealthContract.parseRange(null, "2026-10-02T12:00:00Z", now))
        assertNull(HealthContract.parseRange("2026-10-01T00:00:00Z", "", now))
        assertNull(HealthContract.parseRange("not a date", "2026-10-02T12:00:00Z", now))
        assertNull(HealthContract.parseRange("2026-10-02T12:00:00Z", "2026-10-01T00:00:00Z", now))
        assertNull(HealthContract.parseRange("2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", now))
    }

    @Test fun implausibleNumbersAreDroppedNotClamped() {
        assertEquals(412.0, HealthContract.plausibleKcal(412.0)!!, 0.0)
        assertNull(HealthContract.plausibleKcal(0.0)); assertNull(HealthContract.plausibleKcal(-5.0))
        assertNull(HealthContract.plausibleKcal(2.0e9)); assertNull(HealthContract.plausibleKcal(Double.NaN)); assertNull(HealthContract.plausibleKcal(null))
        assertEquals(128L, HealthContract.plausibleBpm(128L)); assertEquals(20L, HealthContract.plausibleBpm(20L)); assertEquals(260L, HealthContract.plausibleBpm(260L))
        assertNull(HealthContract.plausibleBpm(5L)); assertNull(HealthContract.plausibleBpm(400L)); assertNull(HealthContract.plausibleBpm(null))
        assertEquals(0L, HealthContract.plausibleSteps(0L)); assertEquals(6400L, HealthContract.plausibleSteps(6400L))
        assertNull(HealthContract.plausibleSteps(-1L)); assertNull(HealthContract.plausibleSteps(900000L)); assertNull(HealthContract.plausibleSteps(null))
    }

    @Test fun newestSessionsWinWhenTheBatchIsCapped() {
        val items = (0 until HealthContract.MAX_SESSIONS + 25).map { now.minusSeconds(it * 60L) }
        val out = HealthContract.newestCapped(items) { it }
        assertEquals(HealthContract.MAX_SESSIONS, out.size)
        assertEquals(now, out.first())
        assertTrue(out.zipWithNext().all { (a, b) -> a.isAfter(b) })
    }

    @Test fun anExportCarriesOurOwnIdAndOnlyASaneFinishedSession() {
        val ok = HealthContract.parseWrite("2j:abc123", 1L, ms("2026-10-02T10:00:00Z"), ms("2026-10-02T11:00:00Z"), "strength", "Push", null, now)!!
        assertEquals("2j:abc123", ok.clientRecordId); assertEquals(1L, ok.version); assertEquals("strength", ok.type); assertEquals("Push", ok.title)
        assertNull(ok.notes)
        // not ours / malformed ids are refused: the plugin never writes under a foreign or empty id
        for (bad in listOf(null, "", "abc", "2j:", "2j:has space", "3j:abc", "2j:" + "x".repeat(121)))
            assertNull(bad, HealthContract.parseWrite(bad, 1L, ms("2026-10-02T10:00:00Z"), ms("2026-10-02T11:00:00Z"), "strength", "t", null, now))
    }

    @Test fun anExportIsRefusedOnAnyDoubt() {
        val id = "2j:w"; val s = ms("2026-10-02T10:00:00Z")
        assertNull(HealthContract.parseWrite(id, 1L, null, s, "strength", "t", null, now))
        assertNull(HealthContract.parseWrite(id, 1L, s, s + 30_000, "strength", "t", null, now))                      // under a minute
        assertNull(HealthContract.parseWrite(id, 1L, s, s + 25 * 3600_000L, "strength", "t", null, now))              // over a day
        assertNull(HealthContract.parseWrite(id, 1L, s + 3600_000L, s, "strength", "t", null, now))                    // end before start
        assertNull(HealthContract.parseWrite(id, 1L, ms("2026-10-02T13:00:00Z"), ms("2026-10-02T14:00:00Z"), "strength", "t", null, now))  // future
        assertNull(HealthContract.parseWrite(id, 1L, ms("2026-08-01T10:00:00Z"), ms("2026-08-01T11:00:00Z"), "strength", "t", null, now))  // older than 30 days
        assertNull(HealthContract.parseWrite(id, 1L, s, s + 3600_000L, "swimming", "t", null, now))                    // unknown type
    }

    @Test fun titleAndVersionAreCleanedAndAnEstimateIsAlwaysLabelled() {
        val s = ms("2026-10-02T10:00:00Z")
        val r = HealthContract.parseWrite("2j:w", null, s, s + 3600_000L, null, "  Leg\u0000 day \n" + "x".repeat(200), 312.4, now)!!
        assertEquals("other", r.type); assertEquals(1L, r.version)
        assertTrue(r.title.length <= 80); assertFalse(r.title.any { it.isISOControl() }); assertTrue(r.title.startsWith("Leg"))
        assertEquals(1L, HealthContract.parseWrite("2j:w", -5L, s, s + 3600_000L, "hiit", "", null, now)!!.version)
        assertEquals("2J workout", HealthContract.parseWrite("2j:w", 1L, s, s + 3600_000L, "hiit", "   ", null, now)!!.title)
        val note = r.notes!!
        assertTrue(note.contains("312")); assertTrue(note.contains("estimate")); assertTrue(note.contains("not a measurement"))
        assertNull(HealthContract.noteFor(null)); assertNull(HealthContract.noteFor(0.0)); assertNull(HealthContract.noteFor(Double.NaN)); assertNull(HealthContract.noteFor(9.0e9))
        assertNotNull(HealthContract.noteFor(5.0))
    }

    /* ------------------------------------------------------------- energy reconciliation --- */

    private val own = "com.twojfitnesscenter.app"

    @Test fun theEstimateIdSaysItIsOursAndAnEstimate() {
        assertEquals("2j:w1:kcal-est", HealthContract.estimateClientId("2j:w1"))
        assertNull(HealthContract.estimateClientId("w1")); assertNull(HealthContract.estimateClientId(null)); assertNull(HealthContract.estimateClientId("3j:w1"))
        assertTrue(HealthContract.isOwnEstimate("2j:w1:kcal-est"))
        assertFalse(HealthContract.isOwnEstimate("2j:w1")); assertFalse(HealthContract.isOwnEstimate("x:kcal-est")); assertFalse(HealthContract.isOwnEstimate(null))
    }

    @Test fun anyAggregateEnergyAboveZeroIsExternalWithNoThreshold() {
        assertFalse(HealthContract.hasExternalEnergy(null)); assertFalse(HealthContract.hasExternalEnergy(0.0))
        assertFalse(HealthContract.hasExternalEnergy(-3.0)); assertFalse(HealthContract.hasExternalEnergy(Double.NaN))
        assertTrue(HealthContract.hasExternalEnergy(0.1))      // even a sliver counts: no second sample next to it
        assertTrue(HealthContract.hasExternalEnergy(312.0))
        assertTrue(HealthContract.hasExternalEnergy(50000.0))  // implausible still means "someone wrote energy"
    }

    @Test fun anEstimateWriteIsOurOwnPlausibleIntervalAndNumberOnly() {
        val s = Instant.parse("2026-10-02T10:00:00Z").toEpochMilli(); val e = Instant.parse("2026-10-02T11:00:00Z").toEpochMilli()
        val ok = HealthContract.parseEnergyWrite("2j:w1", 1L, s, e, 250.0, now)!!
        assertEquals("2j:w1:kcal-est", ok.clientRecordId); assertEquals(250.0, ok.kcal, 0.0)
        assertNull(HealthContract.parseEnergyWrite("w1", 1L, s, e, 250.0, now))          // not our id
        assertNull(HealthContract.parseEnergyWrite("2j:w1", 1L, s, e, 0.0, now))         // no energy
        assertNull(HealthContract.parseEnergyWrite("2j:w1", 1L, s, e, 9.0e9, now))       // absurd
        assertNull(HealthContract.parseEnergyWrite("2j:w1", 1L, s, s + 10_000, 250.0, now))   // too short
        assertNull(HealthContract.parseEnergyWrite("2j:w1", 1L, Instant.parse("2026-10-02T13:00:00Z").toEpochMilli(), Instant.parse("2026-10-02T14:00:00Z").toEpochMilli(), 250.0, now))   // future
    }
}
