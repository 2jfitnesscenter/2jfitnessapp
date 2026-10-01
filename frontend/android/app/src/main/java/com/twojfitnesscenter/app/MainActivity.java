package com.twojfitnesscenter.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.twojfitnesscenter.app.health.TwoJHealthPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local Capacitor plugin: Health Connect, read-only (contract: frontend/src/lib/health-bridge.js).
        registerPlugin(TwoJHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
