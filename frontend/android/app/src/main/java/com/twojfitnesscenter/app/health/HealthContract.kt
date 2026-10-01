// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The read-only contract between the TwoJHealth plugin and frontend/src/lib/health-bridge.js,
 * with no Android or Health Connect types so it can be unit-tested on the JVM. Everything the
 * plugin hands to the web app is decided here: which permissions exist (READ only, never write),
 * how a time window is bounded, and which numbers are plausible enough to pass on.
 */
object HealthContract {
    // The names the web app uses, mapped to the Health Connect permission strings (all READ_*).
    const val WORKOUTS = "workouts"
    const val ACTIVE_CALORIES = "activeCalories"
    const val HEART_RATE = "heartRate"
    val READ_PERMISSIONS: Map<String, String> = linkedMapOf(
        WORKOUTS to "android.permission.health.READ_EXERCISE",
        ACTIVE_CALORIES to "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        HEART_RATE to "android.permission.health.READ_HEART_RATE",
    )

    const val MAX_DAYS = 90L
    const val MAX_SESSIONS = 500
    private const val FUTURE_SLACK_SECONDS = 300L

    /** Everything the plugin may ever ask the OS for: read permissions only. */
    fun requestedPermissions(): Set<String> = READ_PERMISSIONS.values.toSet()

    /** Health Connect's granted set → the web app's names, in a stable order. Unknown strings are ignored. */
    fun grantedNames(granted: Set<String>): List<String> = READ_PERMISSIONS.filterValues { it in granted }.keys.toList()

    /** What is still missing, so a repeat call only asks for what was never granted. */
    fun missingPermissions(granted: Set<String>): Set<String> = requestedPermissions() - granted

    /** Calories and heart rate are only read if their own permission exists. */
    fun canReadCalories(granted: Set<String>) = READ_PERMISSIONS.getValue(ACTIVE_CALORIES) in granted
    fun canReadHeartRate(granted: Set<String>) = READ_PERMISSIONS.getValue(HEART_RATE) in granted
    fun canReadWorkouts(granted: Set<String>) = READ_PERMISSIONS.getValue(WORKOUTS) in granted

    data class Range(val start: Instant, val end: Instant)

    /**
     * The window the web app asked for, bounded: ISO instants, end after start, never in the future
     * and never more than 90 days back (the start is moved forward, not refused). Null if unusable.
     */
    fun parseRange(startIso: String?, endIso: String?, now: Instant): Range? {
        val start = parse(startIso) ?: return null
        val end = parse(endIso) ?: return null
        val boundedEnd = minOf(end, now.plusSeconds(FUTURE_SLACK_SECONDS))
        val boundedStart = maxOf(start, now.minus(Duration.ofDays(MAX_DAYS)))
        return if (boundedEnd.isAfter(boundedStart)) Range(boundedStart, boundedEnd) else null
    }
    private fun parse(v: String?): Instant? = try { if (v.isNullOrBlank()) null else Instant.parse(v) } catch (e: DateTimeParseException) { null }

    // Same bounds the web app re-checks (health-bridge.js): anything outside is dropped, not clamped.
    fun plausibleKcal(v: Double?): Double? = if (v != null && v.isFinite() && v > 0.0 && v <= 20000.0) v else null
    fun plausibleBpm(v: Long?): Long? = if (v != null && v in 20L..260L) v else null

    /** Most recent first, capped. */
    fun <T> newestCapped(items: List<T>, startOf: (T) -> Instant): List<T> =
        items.sortedByDescending(startOf).take(MAX_SESSIONS)
}
