// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM tests of the read-only contract (no Android, no Health Connect): ./gradlew testDebugUnitTest */
class HealthContractTest {
    private val now = Instant.parse("2026-10-02T12:00:00Z")

    @Test fun onlyReadPermissionsExist() {
        val all = HealthContract.requestedPermissions()
        assertEquals(3, all.size)
        assertTrue(all.all { it.startsWith("android.permission.health.READ_") })
        assertFalse(all.any { it.contains("WRITE") })
    }

    @Test fun grantedNamesAreTheWebNamesInStableOrder() {
        val rd = HealthContract.READ_PERMISSIONS
        assertEquals(listOf("workouts", "heartRate"), HealthContract.grantedNames(setOf(rd.getValue("heartRate"), rd.getValue("workouts"), "android.permission.CAMERA")))
        assertEquals(emptyList<String>(), HealthContract.grantedNames(emptySet()))
    }

    @Test fun partialAndDeniedGrantsDecideWhatIsReadAndWhatIsAskedAgain() {
        val rd = HealthContract.READ_PERMISSIONS
        val onlyWorkouts = setOf(rd.getValue("workouts"))
        assertTrue(HealthContract.canReadWorkouts(onlyWorkouts))
        assertFalse(HealthContract.canReadCalories(onlyWorkouts))
        assertFalse(HealthContract.canReadHeartRate(onlyWorkouts))
        assertEquals(setOf(rd.getValue("activeCalories"), rd.getValue("heartRate")), HealthContract.missingPermissions(onlyWorkouts))
        assertTrue(HealthContract.missingPermissions(HealthContract.requestedPermissions()).isEmpty())
        // calories/heart rate without workouts: nothing can be listed
        assertFalse(HealthContract.canReadWorkouts(setOf(rd.getValue("heartRate"), rd.getValue("activeCalories"))))
        assertFalse(HealthContract.canReadWorkouts(emptySet()))
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
        assertNull(HealthContract.parseRange("2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", now))   // entirely in the future
    }

    @Test fun implausibleNumbersAreDroppedNotClamped() {
        assertEquals(412.0, HealthContract.plausibleKcal(412.0)!!, 0.0)
        assertNull(HealthContract.plausibleKcal(0.0)); assertNull(HealthContract.plausibleKcal(-5.0))
        assertNull(HealthContract.plausibleKcal(2.0e9)); assertNull(HealthContract.plausibleKcal(Double.NaN)); assertNull(HealthContract.plausibleKcal(null))
        assertEquals(128L, HealthContract.plausibleBpm(128L)); assertEquals(20L, HealthContract.plausibleBpm(20L)); assertEquals(260L, HealthContract.plausibleBpm(260L))
        assertNull(HealthContract.plausibleBpm(5L)); assertNull(HealthContract.plausibleBpm(400L)); assertNull(HealthContract.plausibleBpm(null))
    }

    @Test fun newestSessionsWinWhenTheBatchIsCapped() {
        val items = (0 until HealthContract.MAX_SESSIONS + 25).map { now.minusSeconds(it * 60L) }
        val out = HealthContract.newestCapped(items) { it }
        assertEquals(HealthContract.MAX_SESSIONS, out.size)
        assertEquals(now, out.first())
        assertTrue(out.zipWithNext().all { (a, b) -> a.isAfter(b) })
    }
}
