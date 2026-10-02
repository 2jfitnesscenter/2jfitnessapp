package com.twojfitnesscenter.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.twojfitnesscenter.app.health.TwoJHealthPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local Capacitor plugin: Health Connect, read-only (contract: frontend/src/lib/health-bridge.js).
        registerPlugin(TwoJHealthPlugin.class);
        super.onCreate(savedInstanceState);
        // SPIKE: expose WebAuthn (passkeys) to the remote shell through Credential Manager.
        try {
            boolean ok = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION);
            Log.i("2JSpike", "WEB_AUTHENTICATION supported=" + ok);
            if (ok) {
                WebSettings s = getBridge().getWebView().getSettings();
                WebSettingsCompat.setWebAuthenticationSupport(s, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
                Log.i("2JSpike", "set FOR_APP");
            }
        } catch (Throwable t) { Log.e("2JSpike", "webauthn setup failed", t); }
    }
}
