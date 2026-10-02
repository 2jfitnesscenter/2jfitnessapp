// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * TwoJHealth — Health Connect. The contract is frontend/src/lib/health-bridge.js:
 *
 *   isAvailable()                      → { available, reason?: 'not_installed' | 'unsupported' }
 *   requestPermissions()               → { granted: ('workouts'|'activeCalories'|'heartRate'|'steps')[] }       READ
 *   readWorkouts({ start, end })       → { sessions: Session[] }   (the web adapter unwraps it)
 *   readActivity({ start, end })       → { steps?, activeCaloriesKcal? }   Health Connect's own de-duplicated aggregate
 *   requestWritePermissions()          → { granted: ('writeWorkouts')[] }                                       WRITE, separate consent
 *   writeWorkout({ id, version, start, end, type, title }) → { written: true }
 *   readEnergy({ start, end, id })     → { external: { kcal, origins } | null, ownEstimate, emptyConfirmed: true }   the store's aggregate of OTHER apps' energy
 *   writeEstimatedEnergy({ id, version, start, end, kcal }) → { written: true }   2J's estimate under "<id>:kcal-est"; refused if the aggregate has any energy
 *   deleteEstimatedEnergy({ id })      → { deleted: true }   only what 2J itself wrote (Health Connect enforces it)
 *
 * Reading: no raw heart-rate sample ever leaves this class — a session carries its own aggregates
 * (active calories, average and maximum bpm), each only when that permission exists.
 * Writing: only the workout SESSION, under the client id "2j:<workout id>", so repeating it replaces
 * nothing but itself (Health Connect upserts by client record id) and 2J can recognise it when read
 * back. Never calories or distance, never anything another app wrote. Nothing is stored here and
 * nothing touches the network or the 2J account.
 */
@CapacitorPlugin(name = "TwoJHealth")
class TwoJHealthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var launcher: ActivityResultLauncher<Set<String>>? = null
    private var pendingCallId: String? = null
    private var pendingKind: String = "read"

    override fun load() {
        // Must be registered while the activity is being created (Plugin.load runs then).
        launcher = bridge.registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { _ -> onPermissionResult() }
    }

    override fun handleOnDestroy() { scope.cancel() }

    private fun client(): HealthConnectClient? =
        if (availability() == null) HealthConnectClient.getOrCreate(context) else null

    /** null = available; otherwise the reason the web app understands. */
    private fun availability(): String? {
        if (Build.VERSION.SDK_INT < 26) return "unsupported"
        return when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> null
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "not_installed"
            else -> "unsupported"
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val reason = availability()
        val out = JSObject().put("available", reason == null)
        if (reason != null) out.put("reason", reason)
        call.resolve(out)
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) = request(call, "read")

    @PluginMethod
    fun requestWritePermissions(call: PluginCall) = request(call, "write")

    private fun request(call: PluginCall, kind: String) {
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                val missing = if (kind == "write") HealthContract.missingWritePermissions(granted) else HealthContract.missingPermissions(granted)
                if (missing.isEmpty()) { call.resolve(grantedResult(granted, kind)); return@launch }
                val permissionLauncher = launcher
                if (permissionLauncher == null) {
                    call.reject("Permission request is unavailable", "permission_error")
                    return@launch
                }
                bridge.saveCall(call)
                pendingCallId = call.callbackId
                pendingKind = kind
                // The system sheet decides; denial or partial grants come back through onPermissionResult().
                activity.runOnUiThread {
                    try {
                        permissionLauncher.launch(missing)
                    } catch (e: Exception) {
                        pendingCallId = null
                        bridge.releaseCall(call)
                        call.reject("Could not open Health Connect permissions", "permission_error")
                    }
                }
            } catch (e: Exception) { call.reject("Could not request permissions", "permission_error") }
        }
    }

    private fun onPermissionResult() {
        val id = pendingCallId ?: return
        pendingCallId = null
        val kind = pendingKind
        val call = bridge.getSavedCall(id) ?: return
        val hc = client()
        if (hc == null) { call.reject("Health Connect is not available", "unavailable"); bridge.releaseCall(call); return }
        scope.launch {
            try { call.resolve(grantedResult(hc.permissionController.getGrantedPermissions(), kind)) }
            catch (e: Exception) { call.reject("Could not read permissions", "permission_error") }
            finally { bridge.releaseCall(call) }
        }
    }

    private fun grantedResult(granted: Set<String>, kind: String = "read"): JSObject {
        val arr = JSArray()
        (if (kind == "write") HealthContract.grantedWriteNames(granted) else HealthContract.grantedNames(granted)).forEach { arr.put(it) }
        return JSObject().put("granted", arr)
    }

    @PluginMethod
    fun readWorkouts(call: PluginCall) {
        val range = HealthContract.parseRange(call.getString("start"), call.getString("end"), Instant.now())
            ?: return call.reject("Invalid time range", "invalid_range")
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                // Permissions are re-read every time: the person may have revoked them since.
                val granted = hc.permissionController.getGrantedPermissions()
                if (!HealthContract.canReadWorkouts(granted)) { call.reject("Workout access is not granted", "permission_denied"); return@launch }
                val sessions = readSessions(hc, range)
                val out = JSArray()
                for (s in HealthContract.newestCapped(sessions) { it.startTime }) out.put(toJson(hc, s, granted))
                call.resolve(JSObject().put("sessions", out))
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not read workouts", "read_error") }
        }
    }

    private suspend fun readSessions(hc: HealthConnectClient, range: HealthContract.Range): List<ExerciseSessionRecord> {
        val all = ArrayList<ExerciseSessionRecord>()
        var token: String? = null
        do {
            val page = hc.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.between(range.start, range.end), pageSize = 200, pageToken = token))
            all.addAll(page.records)
            token = page.pageToken.let { if (it.isNullOrEmpty()) null else it }
        } while (token != null && all.size < HealthContract.MAX_SESSIONS * 2)
        return all
    }

    /** One session with only its own aggregates — computed per data origin, never mixed across apps. */
    private suspend fun toJson(hc: HealthConnectClient, s: ExerciseSessionRecord, granted: Set<String>): JSObject {
        val metrics = HashSet<AggregateMetric<*>>()
        val kcal = HealthContract.canReadCalories(granted)
        val hr = HealthContract.canReadHeartRate(granted)
        if (kcal) metrics.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
        if (hr) { metrics.add(HeartRateRecord.BPM_AVG); metrics.add(HeartRateRecord.BPM_MAX) }
        val agg = JSObject()
        if (metrics.isNotEmpty()) {
            try {
                val r = hc.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(s.startTime, s.endTime), setOf(s.metadata.dataOrigin)))
                if (kcal) HealthContract.plausibleKcal(r[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories)?.let { agg.put("activeCaloriesKcal", Math.round(it)) }
                if (hr) {
                    HealthContract.plausibleBpm(r[HeartRateRecord.BPM_AVG])?.let { agg.put("hrAvg", it) }
                    HealthContract.plausibleBpm(r[HeartRateRecord.BPM_MAX])?.let { agg.put("hrMax", it) }
                }
            } catch (e: Exception) { /* a failed aggregate leaves the session without numbers, never without the session */ }
        }
        val origin = JSObject().put("packageName", s.metadata.dataOrigin.packageName)
        val meta = JSObject().put("id", s.metadata.id).put("clientRecordId", s.metadata.clientRecordId).put("dataOrigin", origin)
        return JSObject().put("startTime", s.startTime.toString()).put("endTime", s.endTime.toString())
            .put("exerciseType", s.exerciseType).put("metadata", meta).put("aggregates", agg)
    }

    /** Steps and ACTIVE calories over a window, as Health Connect aggregates them (it de-duplicates its own sources). */
    @PluginMethod
    fun readActivity(call: PluginCall) {
        val range = HealthContract.parseRange(call.getString("start"), call.getString("end"), Instant.now())
            ?: return call.reject("Invalid time range", "invalid_range")
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                val steps = HealthContract.canReadSteps(granted)
                val kcal = HealthContract.canReadCalories(granted)
                if (!steps && !kcal) { call.reject("Activity access is not granted", "permission_denied"); return@launch }
                val metrics = HashSet<AggregateMetric<*>>()
                if (steps) metrics.add(StepsRecord.COUNT_TOTAL)
                if (kcal) metrics.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                val r = hc.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(range.start, range.end)))
                val out = JSObject()
                if (steps) HealthContract.plausibleSteps(r[StepsRecord.COUNT_TOTAL])?.let { out.put("steps", it) }
                if (kcal) HealthContract.plausibleKcal(r[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories)?.let { out.put("activeCaloriesKcal", Math.round(it)) }
                call.resolve(out)
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not read activity", "read_error") }
        }
    }

    /** 2J → Health Connect: one workout session, idempotent by client record id. */
    @PluginMethod
    fun writeWorkout(call: PluginCall) {
        val req = HealthContract.parseWrite(call.getString("id"), call.getLong("version"), call.getLong("start"), call.getLong("end"),
            call.getString("type"), call.getString("title"), call.getDouble("estimatedActiveKcal"), Instant.now())
            ?: return call.reject("Invalid workout", "invalid_workout")
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                if (!HealthContract.canWriteWorkouts(granted)) { call.reject("Write access is not granted", "permission_denied"); return@launch }
                val zone = ZoneId.systemDefault().rules
                val record = ExerciseSessionRecord(
                    startTime = req.start, startZoneOffset = zone.getOffset(req.start),
                    endTime = req.end, endZoneOffset = zone.getOffset(req.end),
                    metadata = Metadata.manualEntry(clientRecordId = req.clientRecordId, clientRecordVersion = req.version),
                    exerciseType = exerciseTypeOf(req.type), title = req.title, notes = req.notes,
                )
                hc.insertRecords(listOf(record))
                call.resolve(JSObject().put("written", true))
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not write the workout", "write_error") }
        }
    }

    /**
     * ACTIVE energy of every app EXCEPT this one for the interval, from Health Connect's own aggregate (so its
     * source de-duplication/priority applies; individual records are never summed here). First the plain
     * aggregate; only if 2J's own origin contributed to it is it asked again restricted to the other origins.
     * Needs READ_ACTIVE_CALORIES_BURNED. Returns kcal (0.0 when nothing) and the other origins.
     */
    private suspend fun externalAggregate(hc: HealthConnectClient, start: Instant, end: Instant): Pair<Double, List<String>> {
        val range = TimeRangeFilter.between(start, end)
        val metric = setOf<AggregateMetric<*>>(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
        val all = hc.aggregate(AggregateRequest(metric, range))
        val others = all.dataOrigins.filter { it.packageName != context.packageName }
        if (others.size == all.dataOrigins.size) return (all[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories ?: 0.0) to others.map { it.packageName }.sorted()
        if (others.isEmpty()) return 0.0 to emptyList()
        val only = hc.aggregate(AggregateRequest(metric, range, others.toSet()))
        return (only[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories ?: 0.0) to others.map { it.packageName }.sorted()
    }

    /** Whether 2J's own estimate record is already in the store (our client id, our origin only). */
    private suspend fun hasOwnEstimate(hc: HealthConnectClient, start: Instant, end: Instant, estimateId: String): Boolean {
        var token: String? = null
        do {
            val page = hc.readRecords(ReadRecordsRequest(ActiveCaloriesBurnedRecord::class, TimeRangeFilter.between(start, end), setOf(DataOrigin(context.packageName)), pageSize = 100, pageToken = token))
            if (page.records.any { it.metadata.clientRecordId == estimateId }) return true
            token = page.pageToken.let { if (it.isNullOrEmpty()) null else it }
        } while (token != null)
        return false
    }

    /** Energy other apps hold for an interval (the store's aggregate), and whether 2J's own estimate for it is already there. */
    @PluginMethod
    fun readEnergy(call: PluginCall) {
        val range = HealthContract.parseRange(call.getString("start") ?: call.getLong("start")?.let { Instant.ofEpochMilli(it).toString() },
            call.getString("end") ?: call.getLong("end")?.let { Instant.ofEpochMilli(it).toString() }, Instant.now())
            ?: return call.reject("Invalid time range", "invalid_range")
        val estimateId = HealthContract.estimateClientId(call.getString("id"))
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                if (!HealthContract.canReadCalories(granted)) { call.reject("Calories access is not granted", "permission_denied"); return@launch }
                val (kcal, origins) = externalAggregate(hc, range.start, range.end)
                // Health Connect tells us when read access is missing (above), so an empty aggregate really is "nothing there".
                val out = JSObject().put("ownEstimate", estimateId != null && hasOwnEstimate(hc, range.start, range.end, estimateId)).put("emptyConfirmed", true)
                if (!HealthContract.hasExternalEnergy(kcal)) out.put("external", JSObject.NULL) else {
                    val o = JSArray(); origins.forEach { o.put(it) }
                    out.put("external", JSObject().put("kcal", Math.round(kcal)).put("origins", o))
                }
                call.resolve(out)
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not read energy", "read_error") }
        }
    }

    /** 2J's own estimate for a workout whose interval has zero external energy in the aggregate: one record, idempotent by client id. */
    @PluginMethod
    fun writeEstimatedEnergy(call: PluginCall) {
        val req = HealthContract.parseEnergyWrite(call.getString("id"), call.getLong("version"), call.getLong("start"), call.getLong("end"), call.getDouble("kcal"), Instant.now())
            ?: return call.reject("Invalid estimate", "invalid_workout")
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                if (!HealthContract.canWriteEnergy(granted)) { call.reject("Write access is not granted", "permission_denied"); return@launch }
                // Writing without read access cannot establish that a wearable hasn't already
                // supplied energy. Fail closed instead of creating a possible duplicate.
                if (!HealthContract.canReadCalories(granted)) { call.reject("Read access is required to check existing energy", "permission_denied"); return@launch }
                // Last guard, immediately before writing: ANY external active energy in the aggregate blocks the estimate.
                if (HealthContract.hasExternalEnergy(externalAggregate(hc, req.start, req.end).first)) { call.reject("The health store already has energy for this interval", "external_available"); return@launch }
                val zone = ZoneId.systemDefault().rules
                val record = ActiveCaloriesBurnedRecord(
                    startTime = req.start, startZoneOffset = zone.getOffset(req.start), endTime = req.end, endZoneOffset = zone.getOffset(req.end),
                    energy = Energy.kilocalories(req.kcal),
                    metadata = Metadata.manualEntry(clientRecordId = req.clientRecordId, clientRecordVersion = req.version),
                )
                hc.insertRecords(listOf(record))
                call.resolve(JSObject().put("written", true))
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not write the estimate", "write_error") }
        }
    }

    /** Remove 2J's own estimate (by its client id). Health Connect only lets an app delete what that app wrote. */
    @PluginMethod
    fun deleteEstimatedEnergy(call: PluginCall) {
        val clientId = HealthContract.estimateClientId(call.getString("id")) ?: return call.reject("Invalid estimate", "invalid_workout")
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                if (!HealthContract.canWriteEnergy(granted)) { call.reject("Write access is not granted", "permission_denied"); return@launch }
                hc.deleteRecords(ActiveCaloriesBurnedRecord::class, emptyList(), listOf(clientId))
                call.resolve(JSObject().put("deleted", true))
            } catch (e: SecurityException) { call.reject("Permission was revoked", "permission_denied")
            } catch (e: Exception) { call.reject("Could not delete the estimate", "write_error") }
        }
    }

    private fun exerciseTypeOf(type: String): Int = when (type) {
        "strength" -> ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING
        "hiit" -> ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING
        "mobility" -> ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING
        else -> ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT
    }
}
