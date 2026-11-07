package br.com.tikplay.sons;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;

import org.json.JSONObject;

public final class MainActivity extends Activity {
    public static final String TIKPLAY_URL = "https://tikplay.com.br/sons-mobile/";
    private static volatile MainActivity current;

    private WebView webView;
    private volatile String currentPageUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(5, 8, 15));
        window.setNavigationBarColor(Color.rgb(5, 8, 15));
        window.getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5, 8, 15));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new TikPlayBridge(), "TikPlayNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                currentPageUrl = url == null ? "" : url;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                currentPageUrl = url == null ? "" : url;
                publishCurrentNativeState();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return routeUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeUrl(Uri.parse(url));
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
        setContentView(webView);
        webView.loadUrl(TIKPLAY_URL);
    }

    private boolean routeUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if ("https".equalsIgnoreCase(scheme) && isTikPlayHost(host)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {}
        return true;
    }

    private static boolean isTikPlayHost(String host) {
        return "tikplay.com.br".equals(host) || host.endsWith(".tikplay.com.br");
    }

    private boolean hasTrustedPage() {
        Uri uri = Uri.parse(currentPageUrl);
        return "https".equalsIgnoreCase(uri.getScheme()) && isTikPlayHost(uri.getHost() == null ? "" : uri.getHost().toLowerCase());
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 73);
        }
    }

    private final class TikPlayBridge {
        @JavascriptInterface
        public boolean start(String token, int volumePercent, float ttsGain) {
            if (!hasTrustedPage() || token == null || token.isEmpty() || token.length() > 4096) return false;
            runOnUiThread(MainActivity.this::requestNotificationPermission);
            Intent intent = new Intent(MainActivity.this, NativeAudioService.class)
                    .setAction(NativeAudioService.ACTION_START)
                    .putExtra(NativeAudioService.EXTRA_TOKEN, token)
                    .putExtra(NativeAudioService.EXTRA_VOLUME, volumePercent)
                    .putExtra(NativeAudioService.EXTRA_TTS_GAIN, ttsGain);
            startNativeService(intent);
            return true;
        }

        @JavascriptInterface
        public void play(String url, String kind, boolean priority) {
            if (!hasTrustedPage()) return;
            sendServiceAction(NativeAudioService.ACTION_PLAY, intent -> intent
                    .putExtra(NativeAudioService.EXTRA_URL, url)
                    .putExtra(NativeAudioService.EXTRA_KIND, kind)
                    .putExtra(NativeAudioService.EXTRA_PRIORITY, priority));
        }

        @JavascriptInterface
        public void setVolumes(int volumePercent, float ttsGain) {
            if (!hasTrustedPage()) return;
            sendServiceAction(NativeAudioService.ACTION_SET_VOLUMES, intent -> intent
                    .putExtra(NativeAudioService.EXTRA_VOLUME, volumePercent)
                    .putExtra(NativeAudioService.EXTRA_TTS_GAIN, ttsGain));
        }

        @JavascriptInterface
        public void setPaused(boolean paused) {
            if (!hasTrustedPage()) return;
            sendServiceAction(paused ? NativeAudioService.ACTION_PAUSE : NativeAudioService.ACTION_RESUME, intent -> intent);
        }

        @JavascriptInterface
        public void stop() {
            if (!hasTrustedPage()) return;
            sendServiceAction(NativeAudioService.ACTION_STOP, intent -> intent);
        }

        @JavascriptInterface
        public boolean isRunning() {
            return hasTrustedPage() && NativeAudioService.isRunning();
        }

        @JavascriptInterface
        public boolean isConnected() {
            return hasTrustedPage() && NativeAudioService.isConnected();
        }

        @JavascriptInterface
        public boolean isPaused() {
            return hasTrustedPage() && NativeAudioService.isPaused();
        }
    }

    private interface IntentEditor {
        Intent apply(Intent intent);
    }

    private void sendServiceAction(String action, IntentEditor editor) {
        if (!NativeAudioService.isRunning()) return;
        Intent intent = editor.apply(new Intent(this, NativeAudioService.class).setAction(action));
        startService(intent);
    }

    private void startNativeService(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
        else startService(intent);
    }

    public static void publishNativeState(String state, String message) {
        MainActivity activity = current;
        if (activity == null || activity.webView == null) return;
        activity.runOnUiThread(() -> {
            if (activity.webView == null) return;
            String script = "if(window.onTikPlayNativeAudioState)window.onTikPlayNativeAudioState(" + JSONObject.quote(state) + "," + JSONObject.quote(message) + ");";
            activity.webView.evaluateJavascript(script, null);
        });
    }

    private void publishCurrentNativeState() {
        if (NativeAudioService.isRunning()) {
            publishNativeState(NativeAudioService.isConnected() ? "connected" : "connecting",
                    NativeAudioService.isConnected() ? "Reprodução nativa pronta para continuar com a tela bloqueada." : "Serviço de reprodução nativa conectando ao TikPlay…");
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        if (webView != null) {
            webView.removeJavascriptInterface("TikPlayNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
