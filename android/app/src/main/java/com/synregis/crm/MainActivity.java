package com.synregis.crm;

import android.app.Activity;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Message;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.widget.FrameLayout;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

public class MainActivity extends Activity {

    private static final String BASE_URL = "https://synregis-crm.vercel.app";
    private static final int FILE_CHOOSER_REQUEST = 4318;
    private static final int MAX_SHARED_IMAGE_BYTES = 8 * 1024 * 1024;

    private FrameLayout root;
    private View lockCover;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String sharedImagePacked; // "mime;base64" for the web app to pull via the bridge

    // Exposed to the web app as window.SynRegisNative
    private class NativeBridge {
        @JavascriptInterface
        public String getSharedImage() {
            String packed = sharedImagePacked;
            sharedImagePacked = null; // one-shot
            return packed == null ? "" : packed;
        }

        // Credentials encrypted with a hardware-keystore key; the app itself is
        // fingerprint-gated, so unlock → auto sign-in with no typing.
        @JavascriptInterface
        public void storeCredentials(String email, String password) {
            try {
                byte[] plain = (email + "\n" + password).getBytes("UTF-8");
                javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                c.init(javax.crypto.Cipher.ENCRYPT_MODE, getOrCreateKey());
                byte[] enc = c.doFinal(plain);
                getSharedPreferences("synregis", MODE_PRIVATE).edit()
                        .putString("cred_iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                        .putString("cred_data", Base64.encodeToString(enc, Base64.NO_WRAP))
                        .apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getCredentials() {
            try {
                android.content.SharedPreferences p = getSharedPreferences("synregis", MODE_PRIVATE);
                String iv = p.getString("cred_iv", null);
                String data = p.getString("cred_data", null);
                if (iv == null || data == null) return "";
                javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                c.init(javax.crypto.Cipher.DECRYPT_MODE, getOrCreateKey(),
                        new javax.crypto.spec.GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                return new String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), "UTF-8");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearCredentials() {
            getSharedPreferences("synregis", MODE_PRIVATE).edit()
                    .remove("cred_iv").remove("cred_data").apply();
        }

        // Web app pushes follow-up data + settings; native schedules the daily alarm.
        @JavascriptInterface
        public void scheduleReminders(String json) {
            try {
                org.json.JSONObject payload = new org.json.JSONObject(json);
                getSharedPreferences("synregis", MODE_PRIVATE).edit()
                        .putBoolean("notif_enabled", payload.optBoolean("enabled", false))
                        .putString("notif_time", payload.optString("time", "09:00"))
                        .putString("notif_payload", json)
                        .apply();
                NotificationHelper.scheduleNext(MainActivity.this);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 100);
                    }
                });
            }
        }
    }

    private javax.crypto.SecretKey getOrCreateKey() throws Exception {
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias("synregis_cred")) {
            return ((java.security.KeyStore.SecretKeyEntry) ks.getEntry("synregis_cred", null)).getSecretKey();
        }
        javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new android.security.keystore.KeyGenParameterSpec.Builder("synregis_cred",
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT
                        | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return kg.generateKey();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        // Navy cover hides the app until the fingerprint check passes;
        // the WebView loads underneath so unlock feels instant.
        root = new FrameLayout(this);
        root.addView(webView);
        lockCover = new View(this);
        lockCover.setBackgroundColor(0xFF08111F);
        root.addView(lockCover, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        // Marker so the web app knows it runs inside the wrapper (hides Google sign-in)
        s.setUserAgentString(s.getUserAgentString() + " SynRegisApp");
        webView.addJavascriptInterface(new NativeBridge(), "SynRegisNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                // Keep the CRM in-app; everything else (maps, attachments, websites) → system browser
                if (host.equals("synregis-crm.vercel.app")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // target=_blank links (attachment PDFs, GPS links) → system browser
                WebView temp = new WebView(MainActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                        } catch (Exception ignored) {}
                        v.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });

        webView.loadUrl(urlForIntent(getIntent()));
        requestUnlock();
    }

    // ── Fingerprint gate (banking-app style) ────────────────────────────────
    private void requestUnlock() {
        if (Build.VERSION.SDK_INT < 29) { unlock(); return; }
        BiometricManager bm = getSystemService(BiometricManager.class);
        boolean available;
        if (Build.VERSION.SDK_INT >= 30) {
            available = bm != null && bm.canAuthenticate(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    == BiometricManager.BIOMETRIC_SUCCESS;
        } else {
            available = bm != null && bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
        }
        if (!available) { unlock(); return; } // no biometrics enrolled → open normally

        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(this)
                .setTitle("SynRegis CRM")
                .setSubtitle("Déverrouillez pour continuer");
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            builder.setDeviceCredentialAllowed(true); // PIN/pattern fallback on API 29
        }
        builder.build().authenticate(new CancellationSignal(), getMainExecutor(),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        unlock();
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        finish(); // cancelled or locked out → close the app
                    }
                });
    }

    private void unlock() {
        if (lockCover != null) {
            root.removeView(lockCover);
            lockCover = null;
        }
    }

    private String urlForIntent(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String type = intent.getType() == null ? "" : intent.getType();
            if (type.startsWith("image/") && readSharedImage(intent)) {
                return BASE_URL + "/?sharedimg=1";
            }
            String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (shared != null && !shared.trim().isEmpty()) {
                try {
                    return BASE_URL + "/?shared=" + URLEncoder.encode(shared, "UTF-8");
                } catch (UnsupportedEncodingException ignored) {}
            }
        }
        return BASE_URL;
    }

    private boolean readSharedImage(Intent intent) {
        try {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return false;
            String mime = getContentResolver().getType(uri);
            if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_SHARED_IMAGE_BYTES) { in.close(); return false; }
                out.write(buf, 0, n);
            }
            in.close();
            sharedImagePacked = mime + ";" + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            webView.loadUrl(urlForIntent(intent));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            filePathCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        // The web app keeps a history sentinel while modals/detail are open,
        // so goBack() closes layers in-app before the app itself exits.
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
