// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.twojfitnesscenter.app.health

import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * TwoJHealth — Health Connect, READ ONLY. The contract is frontend/src/lib/health-bridge.js:
 *
 *   isAvailable()                      → { available, reason?: 'not_installed' | 'unsupported' }
 *   requestPermissions()               → { granted: ('workouts'|'activeCalories'|'heartRate')[] }
 *   readWorkouts({ start, end })       → { sessions: Session[] }   (the web adapter unwraps it)
 *
 * No record is ever written, no raw heart-rate sample ever leaves this class: a session carries
 * its own aggregates (active calories, average and maximum bpm) and only when that permission
 * exists. Nothing is stored here and nothing touches the network or the 2J account.
 */
@CapacitorPlugin(name = "TwoJHealth")
class TwoJHealthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var launcher: ActivityResultLauncher<Set<String>>? = null
    private var pendingCallId: String? = null

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
    override fun requestPermissions(call: PluginCall) {
        val hc = client() ?: return call.reject("Health Connect is not available", "unavailable")
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions()
                val missing = HealthContract.missingPermissions(granted)
                if (missing.isEmpty()) { call.resolve(grantedResult(granted)); return@launch }
                val permissionLauncher = launcher
                if (permissionLauncher == null) {
                    call.reject("Permission request is unavailable", "permission_error")
                    return@launch
                }
                bridge.saveCall(call)
                pendingCallId = call.callbackId
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
        val call = bridge.getSavedCall(id) ?: return
        val hc = client()
        if (hc == null) { call.reject("Health Connect is not available", "unavailable"); bridge.releaseCall(call); return }
        scope.launch {
            try { call.resolve(grantedResult(hc.permissionController.getGrantedPermissions())) }
            catch (e: Exception) { call.reject("Could not read permissions", "permission_error") }
            finally { bridge.releaseCall(call) }
        }
    }

    private fun grantedResult(granted: Set<String>): JSObject {
        val arr = JSArray()
        HealthContract.grantedNames(granted).forEach { arr.put(it) }
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
        val meta = JSObject().put("id", s.metadata.id).put("dataOrigin", origin)
        return JSObject().put("startTime", s.startTime.toString()).put("endTime", s.endTime.toString())
            .put("exerciseType", s.exerciseType).put("metadata", meta).put("aggregates", agg)
    }
}
