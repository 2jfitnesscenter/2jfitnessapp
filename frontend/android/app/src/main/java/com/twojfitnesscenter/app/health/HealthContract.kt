// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The contract between the TwoJHealth plugin and frontend/src/lib/health-bridge.js, with no Android
 * or Health Connect types so it can be unit-tested on the JVM. Everything the plugin hands to the
 * web app or writes to the health store is decided here: which permissions exist (separate READ and
 * WRITE sets), how a time window is bounded, which numbers are plausible, and what a 2J export may
 * contain. 2J writes only the workout SESSION it was asked to, under its own client id.
 */
object HealthContract {
    // The names the web app uses, mapped to the Health Connect permission strings.
    const val WORKOUTS = "workouts"
    const val ACTIVE_CALORIES = "activeCalories"
    const val HEART_RATE = "heartRate"
    const val STEPS = "steps"
    const val WRITE_WORKOUTS = "writeWorkouts"
    const val WRITE_ACTIVE_CALORIES = "writeActiveCalories"

    val READ_PERMISSIONS: Map<String, String> = linkedMapOf(
        WORKOUTS to "android.permission.health.READ_EXERCISE",
        ACTIVE_CALORIES to "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        HEART_RATE to "android.permission.health.READ_HEART_RATE",
        STEPS to "android.permission.health.READ_STEPS",
    )
    // Writing is its own consent: the workout SESSION, and — only for a labelled 2J ESTIMATE written after a grace
    // period when the store's aggregate has NO external energy for the interval — one active-calories record. Never distance.
    val WRITE_PERMISSIONS: Map<String, String> = linkedMapOf(
        WRITE_WORKOUTS to "android.permission.health.WRITE_EXERCISE",
        WRITE_ACTIVE_CALORIES to "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED",
    )

    const val MAX_DAYS = 90L
    const val MAX_SESSIONS = 500
    private const val FUTURE_SLACK_SECONDS = 300L

    /** Everything the plugin asks the OS for when READING. */
    fun requestedPermissions(): Set<String> = READ_PERMISSIONS.values.toSet()
    fun requestedWritePermissions(): Set<String> = WRITE_PERMISSIONS.values.toSet()

    /** Health Connect's granted set → the web app's names, in a stable order. Unknown strings are ignored. */
    fun grantedNames(granted: Set<String>): List<String> = READ_PERMISSIONS.filterValues { it in granted }.keys.toList()
    fun grantedWriteNames(granted: Set<String>): List<String> = WRITE_PERMISSIONS.filterValues { it in granted }.keys.toList()

    /** What is still missing, so a repeat call only asks for what was never granted. */
    fun missingPermissions(granted: Set<String>): Set<String> = requestedPermissions() - granted
    fun missingWritePermissions(granted: Set<String>): Set<String> = requestedWritePermissions() - granted

    fun canReadCalories(granted: Set<String>) = READ_PERMISSIONS.getValue(ACTIVE_CALORIES) in granted
    fun canReadHeartRate(granted: Set<String>) = READ_PERMISSIONS.getValue(HEART_RATE) in granted
    fun canReadWorkouts(granted: Set<String>) = READ_PERMISSIONS.getValue(WORKOUTS) in granted
    fun canReadSteps(granted: Set<String>) = READ_PERMISSIONS.getValue(STEPS) in granted
    fun canWriteWorkouts(granted: Set<String>) = WRITE_PERMISSIONS.getValue(WRITE_WORKOUTS) in granted
    fun canWriteEnergy(granted: Set<String>) = WRITE_PERMISSIONS.getValue(WRITE_ACTIVE_CALORIES) in granted

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
    fun plausibleSteps(v: Long?): Long? = if (v != null && v in 0L..200000L) v else null

    /** Most recent first, capped. */
    fun <T> newestCapped(items: List<T>, startOf: (T) -> Instant): List<T> =
        items.sortedByDescending(startOf).take(MAX_SESSIONS)

    /* ------------------------------------------------------------------ export (2J → Health) --- */

    const val OWN_ID_PREFIX = "2j:"
    private val ID_SHAPE = Regex("^2j:[A-Za-z0-9_.:-]{1,120}$")
    private const val MIN_SESSION_SECONDS = 60L
    private const val MAX_SESSION_HOURS = 24L
    private const val MAX_EXPORT_AGE_DAYS = 30L
    // The logical types the web app sends; the plugin maps each to its Health Connect enum.
    val EXPORT_TYPES = setOf("strength", "hiit", "mobility", "other")

    data class WriteRequest(
        val clientRecordId: String, val version: Long, val start: Instant, val end: Instant,
        val type: String, val title: String, val notes: String?,
    )

    /**
     * A 2J export request, validated: our own id (so it can be recognised — and ignored — when it is
     * read back), a plausible finished session (1 min to 24 h, not in the future, not older than 30
     * days) and a known type. Calories are never part of it: a 2J estimate travels only as a note that
     * says it is an estimate. Null if anything is off — nothing is written on a doubt.
     */
    fun parseWrite(id: String?, version: Long?, startMs: Long?, endMs: Long?, type: String?, title: String?, estimatedKcal: Double?, now: Instant): WriteRequest? {
        if (id == null || !ID_SHAPE.matches(id)) return null
        if (startMs == null || endMs == null) return null
        val start = Instant.ofEpochMilli(startMs)
        val end = Instant.ofEpochMilli(endMs)
        val seconds = Duration.between(start, end).seconds
        if (seconds < MIN_SESSION_SECONDS || seconds > MAX_SESSION_HOURS * 3600) return null
        if (end.isAfter(now.plusSeconds(FUTURE_SLACK_SECONDS)) || start.isBefore(now.minus(Duration.ofDays(MAX_EXPORT_AGE_DAYS)))) return null
        val kind = type ?: "other"
        if (kind !in EXPORT_TYPES) return null
        val clean = (title ?: "").filter { !it.isISOControl() }.trim().take(80).ifEmpty { "2J workout" }
        return WriteRequest(id, (version ?: 1L).coerceIn(1L, 1_000_000L), start, end, kind, clean, noteFor(estimatedKcal))
    }

    /** The only energy 2J ever puts next to a session: its own estimate, labelled as one. */
    fun noteFor(estimatedKcal: Double?): String? {
        val k = estimatedKcal
        return if (k != null && k.isFinite() && k > 0.0 && k <= 20000.0)
            "Recorded in 2J Fitness Center. Active energy estimated by 2J: about ${Math.round(k)} kcal (an estimate, not a measurement)."
        else null
    }

    /* ------------------------------------------------ energy reconciliation (2J's own estimate) --- */

    const val ESTIMATE_SUFFIX = ":kcal-est"

    /** The id the estimate is stored under — it says "2J" and "estimate", so it can never be mistaken for anything else. */
    fun estimateClientId(id: String?): String? = if (id != null && ID_SHAPE.matches(id)) id + ESTIMATE_SUFFIX else null
    fun isOwnEstimate(clientRecordId: String?): Boolean = clientRecordId != null && clientRecordId.startsWith(OWN_ID_PREFIX) && clientRecordId.endsWith(ESTIMATE_SUFFIX)

    /**
     * Energy from another app = ANY active energy above zero in the store's own aggregate for the interval
     * (Health Connect already applies its source de-duplication/priority). Individual records are never summed
     * here and no coverage threshold decides whether a 2J estimate may be written: any external energy blocks it.
     */
    fun hasExternalEnergy(aggregateKcal: Double?): Boolean = aggregateKcal != null && aggregateKcal.isFinite() && aggregateKcal > 0.0

    data class EnergyWrite(val clientRecordId: String, val version: Long, val start: Instant, val end: Instant, val kcal: Double)

    /** A validated estimate write: our own id, a plausible interval (1 min–24 h, not future, within 30 days), a plausible kcal. */
    fun parseEnergyWrite(id: String?, version: Long?, startMs: Long?, endMs: Long?, kcal: Double?, now: Instant): EnergyWrite? {
        val clientId = estimateClientId(id) ?: return null
        val k = plausibleKcal(kcal) ?: return null
        val w = parseWrite(id, version, startMs, endMs, "other", null, null, now) ?: return null
        return EnergyWrite(clientId, w.version, w.start, w.end, k)
    }
}
