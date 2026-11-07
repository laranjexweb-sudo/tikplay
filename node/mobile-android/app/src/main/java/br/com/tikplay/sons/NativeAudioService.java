package br.com.tikplay.sons;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.audiofx.LoudnessEnhancer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import org.json.JSONObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class NativeAudioService extends Service {
    public static final String ACTION_START = "br.com.tikplay.sons.START";
    public static final String ACTION_PLAY = "br.com.tikplay.sons.PLAY";
    public static final String ACTION_SET_VOLUMES = "br.com.tikplay.sons.SET_VOLUMES";
    public static final String ACTION_PAUSE = "br.com.tikplay.sons.PAUSE";
    public static final String ACTION_RESUME = "br.com.tikplay.sons.RESUME";
    public static final String ACTION_STOP = "br.com.tikplay.sons.STOP";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_KIND = "kind";
    public static final String EXTRA_PRIORITY = "priority";
    public static final String EXTRA_VOLUME = "volume";
    public static final String EXTRA_TTS_GAIN = "tts_gain";

    private static final String BASE_URL = "https://tikplay.com.br";
    private static final String CHANNEL_ID = "tikplay-live-audio";
    private static final int NOTIFICATION_ID = 7412;
    private static final int MAX_QUEUE = 12;
    private static volatile boolean running;
    private static volatile boolean connected;
    private static volatile boolean paused;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build();
    private final Map<String, SoundEntry> sounds = new HashMap<>();
    private final Map<String, String> actions = new HashMap<>();

    private ExoPlayer player;
    private WebSocket socket;
    private volatile String token = "";
    private volatile boolean destroyed;
    private int volumePercent = 100;
    private float ttsGain = 1f;
    private float currentKindGain = 1f;
    private int gifterMinLevel = 30;
    private long queueSequence;
    private LoudnessEnhancer loudnessEnhancer;
    private int loudnessSessionId = C.AUDIO_SESSION_ID_UNSET;

    public static boolean isRunning() { return running; }
    public static boolean isConnected() { return connected; }
    public static boolean isPaused() { return paused; }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        running = true;
        paused = false;
        destroyed = false;
        player = new ExoPlayer.Builder(this).build();
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .build();
        // Keep TikTok's live audio session from being paused by media focus changes.
        player.setAudioAttributes(audioAttributes, false);
        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                applyGainForCurrentItem();
                updateNotification(currentStatusText());
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED && player != null) player.clearMediaItems();
                updateNotification(currentStatusText());
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                MainActivity.publishNativeState("error", "O Android não conseguiu reproduzir um áudio. Confira a conexão e o formato do arquivo.");
                updateNotification("Não foi possível reproduzir um áudio");
            }

            @Override
            public void onAudioSessionIdChanged(int audioSessionId) {
                attachLoudnessEnhancer(audioSessionId);
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            String suppliedToken = intent.getStringExtra(EXTRA_TOKEN);
            if (suppliedToken == null || suppliedToken.isEmpty() || suppliedToken.length() > 4096) {
                stopSelf(startId);
                return START_NOT_STICKY;
            }
            token = suppliedToken;
            volumePercent = clamp(intent.getIntExtra(EXTRA_VOLUME, 100), 0, 100);
            ttsGain = clamp(intent.getFloatExtra(EXTRA_TTS_GAIN, 1f), 0f, 3f);
            startForegroundNow();
            setPlayerVolume();
            if (!connected) loadConfigurationThenConnect();
            MainActivity.publishNativeState("connecting", "Serviço Android ativo; conectando ao TikPlay…");
        } else if (ACTION_PLAY.equals(action)) {
            enqueueAudio(intent.getStringExtra(EXTRA_URL),
                    intent.getStringExtra(EXTRA_KIND), intent.getBooleanExtra(EXTRA_PRIORITY, false), null);
        } else if (ACTION_SET_VOLUMES.equals(action)) {
            volumePercent = clamp(intent.getIntExtra(EXTRA_VOLUME, volumePercent), 0, 100);
            ttsGain = clamp(intent.getFloatExtra(EXTRA_TTS_GAIN, ttsGain), 0f, 3f);
            setPlayerVolume();
        } else if (ACTION_PAUSE.equals(action)) {
            setPaused(true);
        } else if (ACTION_RESUME.equals(action)) {
            setPaused(false);
        } else if (ACTION_STOP.equals(action)) {
            stopPlaybackService();
        }
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        Notification notification = buildNotification(currentStatusText());
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Áudio da live", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantém os sons e a narração do TikPlay ativos durante a live.");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String message) {
        Intent openIntent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 1, openIntent, pendingIntentFlags());
        PendingIntent pause = PendingIntent.getService(this, 2,
                new Intent(this, NativeAudioService.class).setAction(paused ? ACTION_RESUME : ACTION_PAUSE), pendingIntentFlags());
        PendingIntent stop = PendingIntent.getService(this, 3,
                new Intent(this, NativeAudioService.class).setAction(ACTION_STOP), pendingIntentFlags());
        String pauseLabel = paused ? "Retomar" : "Pausar";
        if (Build.VERSION.SDK_INT >= 26) {
            return new Notification.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_tikplay)
                    .setContentTitle("TikPlay Sons")
                    .setContentText(message)
                    .setCategory(Notification.CATEGORY_SERVICE)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setContentIntent(content)
                    .setOngoing(true)
                    .setShowWhen(false)
                    .addAction(new Notification.Action.Builder(0, pauseLabel, pause).build())
                    .addAction(new Notification.Action.Builder(0, "Encerrar", stop).build())
                    .build();
        }
        return new Notification.Builder(this)
                .setSmallIcon(R.drawable.ic_stat_tikplay)
                .setContentTitle("TikPlay Sons")
                .setContentText(message)
                .setContentIntent(content)
                .setOngoing(true)
                .build();
    }

    private int pendingIntentFlags() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT;
    }

    private void updateNotification(String message) {
        if (!running) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(message));
    }

    private String currentStatusText() {
        if (paused) return "Reprodução pausada · toque para abrir";
        if (player != null && player.isPlaying()) return "Reproduzindo áudio da live";
        return connected ? "Conectado · aguardando sons da live" : "Conectando ao TikPlay…";
    }

    private void loadConfigurationThenConnect() {
        if (token.isEmpty() || destroyed) return;
        connected = false;
        if (socket != null) { socket.cancel(); socket = null; }
        networkExecutor.execute(() -> {
            if (destroyed) return;
            try {
                JSONObject giftResponse = requestJson("/api/sound-alerts");
                JSONObject actionResponse = requestJson("/api/action-sound-alerts");
                readConfiguration(giftResponse, actionResponse);
                connectSocket();
            } catch (IOException error) {
                if (destroyed) return;
                MainActivity.publishNativeState("error", "Não foi possível carregar seus alertas. O app tentará novamente.");
                updateNotification("Falha ao carregar alertas · tentando novamente");
                scheduleReconnect();
            } catch (Exception error) {
                if (destroyed) return;
                MainActivity.publishNativeState("error", "Não foi possível preparar a conexão de áudio.");
                scheduleReconnect();
            }
        });
    }

    private JSONObject requestJson(String path) throws Exception {
        Request request = new Request.Builder()
                .url(BASE_URL + path)
                .header("Authorization", "Bearer " + token)
                .get()
                .build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) throw new IOException("TikPlay API request failed");
            return new JSONObject(response.body().string());
        }
    }

    private void readConfiguration(JSONObject giftResponse, JSONObject actionResponse) {
        Map<String, SoundEntry> newSounds = new HashMap<>();
        JSONObject alerts = giftResponse.optJSONObject("alerts");
        if (alerts != null) {
            Iterator<String> names = alerts.keys();
            while (names.hasNext()) {
                String name = names.next();
                JSONObject item = alerts.optJSONObject(name);
                if (item == null) continue;
                newSounds.put(name.toLowerCase(Locale.ROOT), new SoundEntry(item.optString("normal", ""), item.optString("combo", "")));
            }
        }
        Map<String, String> newActions = new HashMap<>();
        JSONObject actionAlerts = actionResponse.optJSONObject("alerts");
        if (actionAlerts != null) {
            Iterator<String> names = actionAlerts.keys();
            while (names.hasNext()) {
                String name = names.next();
                newActions.put(name, actionAlerts.optString(name, ""));
            }
        }
        synchronized (sounds) {
            sounds.clear();
            sounds.putAll(newSounds);
        }
        synchronized (actions) {
            actions.clear();
            actions.putAll(newActions);
        }
        gifterMinLevel = Math.max(1, actionResponse.optInt("gifter_min_level", 30));
    }

    private void connectSocket() {
        if (destroyed || token.isEmpty() || connected) return;
        HttpUrl base = HttpUrl.parse(BASE_URL + "/logs");
        if (base == null) {
            scheduleReconnect();
            return;
        }
        Request request = new Request.Builder()
                .url(base.newBuilder().addQueryParameter("token", token).build())
                .build();
        socket = http.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                connected = true;
                MainActivity.publishNativeState("connected", "Reprodução nativa pronta; os sons continuam com a tela bloqueada.");
                updateNotification("Conectado · aguardando sons da live");
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                handleServerMessage(text);
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                connected = false;
                if (!destroyed) {
                    MainActivity.publishNativeState("connecting", "Reconectando o áudio do TikPlay…");
                    scheduleReconnect();
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                connected = false;
                if (destroyed) return;
                if (response != null && (response.code() == 401 || response.code() == 403)) {
                    MainActivity.publishNativeState("error", "Sessão expirada. Entre novamente no TikPlay Sons.");
                    stopSelf();
                    return;
                }
                MainActivity.publishNativeState("connecting", "Sem conexão com o TikPlay; tentando novamente…");
                updateNotification("Sem conexão · tentando novamente");
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (destroyed || token.isEmpty()) return;
        main.removeCallbacks(reconnectRunnable);
        main.postDelayed(reconnectRunnable, 2500L);
    }

    private final Runnable reconnectRunnable = () -> {
        if (destroyed || connected) return;
        loadConfigurationThenConnect();
    };

    private void handleServerMessage(String raw) {
        JSONObject message;
        try {
            message = new JSONObject(raw);
        } catch (Exception ignored) {
            return;
        }
        String type = message.optString("type", "");
        if ("chat_narrate".equals(type)) {
            if (message.optBoolean("reset", false)) {
                main.post(() -> removeQueuedKind("chat"));
            } else {
                enqueueAudio(message.optString("url", ""), "chat", false, null);
            }
        } else if ("gift_event".equals(type)) {
            handleGift(message);
        } else if ("action_alert_event".equals(type)) {
            String action = message.optString("action", "");
            String url;
            synchronized (actions) { url = actions.getOrDefault(action, ""); }
            if ("gifter_join".equals(action) && message.optInt("gifter_level", 0) < gifterMinLevel) return;
            enqueueAudio(url, "sound", false, "Alerta TikPlay");
        } else if ("riddle_ready".equals(type) && message.has("audio_url")) {
            enqueueAudio(message.optString("audio_url", ""), "tts", true, "Narração TikPlay");
        } else if ("riddle_audio".equals(type)) {
            enqueueAudio(message.optString("audio_url", ""), "tts", true, "Narração TikPlay");
        } else if ("tts_test_ready".equals(type)) {
            enqueueAudio(message.optString("url", ""), "tts", true, "Teste de voz");
        } else if ("sound_alerts_updated".equals(type)) {
            loadConfigurationThenConnectIfOpen();
        }
    }

    private void loadConfigurationThenConnectIfOpen() {
        if (destroyed || token.isEmpty()) return;
        networkExecutor.execute(() -> {
            try {
                readConfiguration(requestJson("/api/sound-alerts"), requestJson("/api/action-sound-alerts"));
            } catch (Exception ignored) {}
        });
    }

    private void handleGift(JSONObject message) {
        String gift = message.optString("gift", "").trim().toLowerCase(Locale.ROOT);
        String giftId = message.optString("gift_id", "").trim().toLowerCase(Locale.ROOT);
        SoundEntry entry;
        synchronized (sounds) {
            entry = sounds.get(gift);
            if (entry == null) entry = sounds.get(giftId);
            if (entry == null && !giftId.isEmpty()) {
                for (Map.Entry<String, SoundEntry> item : sounds.entrySet()) {
                    if (item.getKey().equalsIgnoreCase(giftId)) { entry = item.getValue(); break; }
                }
            }
        }
        if (entry == null) return;
        int repeat = Math.max(1, message.optInt("repeat_count", 1));
        String url = repeat > 1 && !entry.combo.isEmpty() ? entry.combo : entry.normal;
        int count = repeat > 1 && entry.combo.isEmpty() ? Math.min(repeat, 5) : 1;
        for (int index = 0; index < count; index++) enqueueAudio(url, "sound", false, "Alerta de presente");
    }

    private void enqueueAudio(String rawUrl, String kind, boolean priority, String title) {
        main.post(() -> {
            if (destroyed || player == null || paused) return;
            Uri uri = resolveAudioUrl(rawUrl);
            if (uri == null) return;
            if (player.getPlaybackState() == Player.STATE_ENDED) player.clearMediaItems();
            if (player.getMediaItemCount() >= MAX_QUEUE) {
                if (!priority || !dropNextNonPriority()) return;
            }
            String safeKind = "chat".equals(kind) ? "chat" : (("tts".equals(kind)) ? "tts" : "sound");
            String id = safeKind + (priority ? "|p|" : "|n|") + (++queueSequence);
            String safeTitle = title == null ? ("tts".equals(safeKind) ? "Narração TikPlay" : "Som TikPlay") : title;
            MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(safeTitle)
                    .setArtist("TikPlay Sons")
                    .build();
            MediaItem item = new MediaItem.Builder().setMediaId(id).setUri(uri).setMediaMetadata(metadata).build();
            int count = player.getMediaItemCount();
            if (priority && count > 0 && player.getCurrentMediaItemIndex() >= 0) {
                player.addMediaItem(Math.min(count, player.getCurrentMediaItemIndex() + 1), item);
            } else {
                player.addMediaItem(item);
            }
            applyGainForCurrentItem();
            if (player.getPlaybackState() == Player.STATE_IDLE || player.getPlaybackState() == Player.STATE_ENDED) player.prepare();
            player.play();
            updateNotification(currentStatusText());
        });
    }

    private Uri resolveAudioUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isEmpty() || rawUrl.length() > 2048) return null;
        Uri uri = Uri.parse(rawUrl.startsWith("/") ? BASE_URL + rawUrl : rawUrl);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getPath() == null ? "" : uri.getPath();
        boolean audioPath = path.startsWith("/alert-audio/") || path.startsWith("/tts-audio/");
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !"tikplay.com.br".equals(host) || !audioPath) return null;
        return uri;
    }

    private boolean dropNextNonPriority() {
        if (player == null || player.getMediaItemCount() == 0) return false;
        int current = player.getCurrentMediaItemIndex();
        int firstPending = player.isPlaying() || current >= 0 ? current + 1 : 0;
        for (int index = Math.max(0, firstPending); index < player.getMediaItemCount(); index++) {
            String id = player.getMediaItemAt(index).mediaId;
            if (!id.contains("|p|")) {
                player.removeMediaItem(index);
                return true;
            }
        }
        return false;
    }

    private void removeQueuedKind(String kind) {
        if (player == null || player.getMediaItemCount() == 0) return;
        int current = player.getCurrentMediaItemIndex();
        int firstPending = player.isPlaying() || current >= 0 ? current + 1 : 0;
        for (int index = player.getMediaItemCount() - 1; index >= Math.max(0, firstPending); index--) {
            if (player.getMediaItemAt(index).mediaId.startsWith(kind + "|")) player.removeMediaItem(index);
        }
    }

    private void setPaused(boolean shouldPause) {
        paused = shouldPause;
        if (player != null) {
            if (shouldPause) {
                player.pause();
                player.clearMediaItems();
            } else if (player.getMediaItemCount() > 0) {
                player.play();
            }
        }
        MainActivity.publishNativeState(shouldPause ? "paused" : "connected", shouldPause ? "Áudios pausados no Android." : "Reprodução nativa retomada.");
        updateNotification(currentStatusText());
    }

    private void setPlayerVolume() {
        if (player != null) applyGainForCurrentItem();
    }

    private void applyGainForCurrentItem() {
        if (player == null) return;
        MediaItem item = player.getCurrentMediaItem();
        String id = item == null ? "" : item.mediaId;
        boolean isTts = id.startsWith("chat|") || id.startsWith("tts|");
        currentKindGain = isTts ? ttsGain : 1f;
        float multiplier = Math.max(0f, Math.min(3f, currentKindGain));
        if (multiplier <= 1f) {
            player.setVolume((volumePercent / 100f) * multiplier);
            applyLoudness(0);
        } else {
            player.setVolume(volumePercent / 100f);
            applyLoudness((int) Math.round(2000d * Math.log10(multiplier)));
        }
    }

    private void attachLoudnessEnhancer(int sessionId) {
        if (sessionId == C.AUDIO_SESSION_ID_UNSET || sessionId == loudnessSessionId) return;
        releaseLoudnessEnhancer();
        try {
            loudnessEnhancer = new LoudnessEnhancer(sessionId);
            loudnessSessionId = sessionId;
            applyGainForCurrentItem();
        } catch (Exception ignored) {
            loudnessEnhancer = null;
            loudnessSessionId = C.AUDIO_SESSION_ID_UNSET;
        }
    }

    private void applyLoudness(int targetGainMb) {
        if (loudnessEnhancer == null) return;
        try {
            loudnessEnhancer.setTargetGain(Math.max(0, Math.min(954, targetGainMb)));
            loudnessEnhancer.setEnabled(targetGainMb > 0);
        } catch (Exception ignored) {}
    }

    private void releaseLoudnessEnhancer() {
        if (loudnessEnhancer == null) return;
        try { loudnessEnhancer.setEnabled(false); loudnessEnhancer.release(); } catch (Exception ignored) {}
        loudnessEnhancer = null;
        loudnessSessionId = C.AUDIO_SESSION_ID_UNSET;
    }

    private void stopPlaybackService() {
        destroyed = true;
        connected = false;
        running = false;
        paused = false;
        token = "";
        main.removeCallbacks(reconnectRunnable);
        if (socket != null) { socket.close(1000, "Stopped by user"); socket = null; }
        if (player != null) { player.stop(); player.clearMediaItems(); player.release(); player = null; }
        releaseLoudnessEnhancer();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        MainActivity.publishNativeState("stopped", "Reprodução nativa encerrada.");
    }

    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private static float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }

    @Override
    public void onDestroy() {
        destroyed = true;
        connected = false;
        running = false;
        paused = false;
        token = "";
        main.removeCallbacks(reconnectRunnable);
        if (socket != null) { socket.cancel(); socket = null; }
        if (player != null) { player.release(); player = null; }
        releaseLoudnessEnhancer();
        networkExecutor.shutdownNow();
        http.dispatcher().cancelAll();
        MainActivity.publishNativeState("stopped", "Serviço de áudio encerrado.");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private static final class SoundEntry {
        final String normal;
        final String combo;
        SoundEntry(String normal, String combo) {
            this.normal = normal == null ? "" : normal;
            this.combo = combo == null ? "" : combo;
        }
    }
}
