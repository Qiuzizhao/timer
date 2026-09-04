const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.qiuzizhao.timer';

const SERVICE_KT = `package ${PACKAGE}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the app process alive and plays the timer's
 * tick / finish sounds natively, so the countdown stays audible even when the
 * app is backgrounded (Android has no iOS-style audio background mode).
 */
class TimerForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "timer_foreground"
    const val NOTIFICATION_ID = 20260904
    const val ACTION_START = "com.qiuzizhao.timer.START"
    const val ACTION_UPDATE = "com.qiuzizhao.timer.UPDATE"
    const val ACTION_ADD_MINUTE = "com.qiuzizhao.timer.ADD_MINUTE"
    const val ACTION_STOP = "com.qiuzizhao.timer.STOP"
    const val EXTRA_ENDS_AT = "endsAt"
    const val EXTRA_SOUND = "soundEnabled"
  }

  private lateinit var soundPool: SoundPool
  private var tickSound = 0
  private var ringSound = 0
  private var promptSound = 0
  private var addMinuteSound = 0

  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var running = false
  private var endsAt = 0L
  private var soundEnabled = true

  private val tickRunnable = object : Runnable {
    override fun run() {
      if (!running) return
      val remaining = endsAt - System.currentTimeMillis()
      if (remaining <= 0) {
        running = false
        if (soundEnabled) play(ringSound)
        handler.removeCallbacks(this)
        stopSelf()
        return
      }
      if (soundEnabled) play(tickSound)
      handler.postDelayed(this, 1000L)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createChannel()
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    soundPool = SoundPool.Builder().setMaxStreams(4).setAudioAttributes(attributes).build()
    tickSound = soundPool.load(this, R.raw.timer_tick, 1)
    ringSound = soundPool.load(this, R.raw.timer_ring, 1)
    promptSound = soundPool.load(this, R.raw.timer_prompt, 1)
    addMinuteSound = soundPool.load(this, R.raw.timer_add_minute_voice, 1)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopTimer()
      ACTION_START -> {
        endsAt = intent.getLongExtra(EXTRA_ENDS_AT, System.currentTimeMillis() + 1000)
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND, true)
        startForeground(NOTIFICATION_ID, buildNotification())
        running = true
        handler.removeCallbacks(tickRunnable)
        if (soundEnabled) play(promptSound)
        handler.postDelayed(tickRunnable, 1000L)
      }
      ACTION_UPDATE -> {
        endsAt = intent.getLongExtra(EXTRA_ENDS_AT, endsAt)
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND, soundEnabled)
      }
      ACTION_ADD_MINUTE -> {
        endsAt = intent.getLongExtra(EXTRA_ENDS_AT, endsAt)
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND, soundEnabled)
        if (soundEnabled) play(addMinuteSound)
      }
      else -> {
        if (!running) startForeground(NOTIFICATION_ID, buildNotification())
      }
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    running = false
    handler.removeCallbacks(tickRunnable)
    if (soundPool != null) soundPool.release()
    stopForeground(true)
    super.onDestroy()
  }

  private fun stopTimer() {
    running = false
    handler.removeCallbacks(tickRunnable)
    stopForeground(true)
    stopSelf()
  }

  private fun play(soundId: Int) {
    if (soundId <= 0) return
    soundPool.play(soundId, 1f, 1f, 1, 0, 1f)
  }

  private fun createChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "计时器后台运行",
      NotificationManager.IMPORTANCE_LOW
    )
    channel.setShowBadge(false)
    channel.description = "倒计时在后台运行时保持进程存活并播放提示音"
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val intent = Intent(this, MainActivity::class.java)
    val pending = PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("计时进行中")
      .setContentText("倒计时正在后台运行")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setOngoing(true)
      .setContentIntent(pending)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
`;

const MODULE_KT = `package ${PACKAGE}

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TimerForegroundModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "TimerForeground"

  @ReactMethod
  fun start(endsAt: Double, soundEnabled: Boolean) {
    val intent = serviceIntent(TimerForegroundService.ACTION_START)
      .putExtra(TimerForegroundService.EXTRA_ENDS_AT, endsAt.toLong())
      .putExtra(TimerForegroundService.EXTRA_SOUND, soundEnabled)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactApplicationContext.startForegroundService(intent)
    } else {
      reactApplicationContext.startService(intent)
    }
  }

  @ReactMethod
  fun update(endsAt: Double, soundEnabled: Boolean) {
    reactApplicationContext.startService(
      serviceIntent(TimerForegroundService.ACTION_UPDATE)
        .putExtra(TimerForegroundService.EXTRA_ENDS_AT, endsAt.toLong())
        .putExtra(TimerForegroundService.EXTRA_SOUND, soundEnabled)
    )
  }

  @ReactMethod
  fun addMinute(endsAt: Double, soundEnabled: Boolean) {
    reactApplicationContext.startService(
      serviceIntent(TimerForegroundService.ACTION_ADD_MINUTE)
        .putExtra(TimerForegroundService.EXTRA_ENDS_AT, endsAt.toLong())
        .putExtra(TimerForegroundService.EXTRA_SOUND, soundEnabled)
    )
  }

  @ReactMethod
  fun stop() {
    reactApplicationContext.stopService(
      serviceIntent(TimerForegroundService.ACTION_STOP)
    )
  }

  private fun serviceIntent(action: String): Intent =
    Intent(reactApplicationContext, TimerForegroundService::class.java).setAction(action)
}
`;

const PACKAGE_KT = `package ${PACKAGE}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class TimerForegroundPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(TimerForegroundModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withServiceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const permissions = manifest['uses-permission'] || [];
    const addPermission = (name) => {
      if (!permissions.some((p) => p.$['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    };
    addPermission('android.permission.FOREGROUND_SERVICE');
    addPermission('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    addPermission('android.permission.POST_NOTIFICATIONS');
    manifest['uses-permission'] = permissions;

    const application = manifest.application && manifest.application[0];
    if (application) {
      const services = application.service || [];
      const exists = services.some((s) => s.$['android:name'] === '.TimerForegroundService');
      if (!exists) {
        services.push({
          $: {
            'android:name': '.TimerForegroundService',
            'android:enabled': 'true',
            'android:exported': 'false',
            'android:foregroundServiceType': 'mediaPlayback',
          },
        });
      }
      application.service = services;
    }

    return cfg;
  });
}

function withServiceSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const base = path.join(root, 'app', 'src', 'main', 'java', ...PACKAGE.split('.'));
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, 'TimerForegroundService.kt'), SERVICE_KT);
      fs.writeFileSync(path.join(base, 'TimerForegroundModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(base, 'TimerForegroundPackage.kt'), PACKAGE_KT);
      // Copy timer sounds into raw resources so the service can play them.
      const projectRoot = cfg.modRequest.projectRoot;
      const sounds = path.join(projectRoot, 'assets', 'sounds');
      const raw = path.join(root, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(raw, { recursive: true });
      const mapping = [
        ['timer-tick.wav', 'timer_tick.wav'],
        ['timer-ring.wav', 'timer_ring.wav'],
        ['timer-prompt.wav', 'timer_prompt.wav'],
        ['timer-add-minute-voice.mp3', 'timer_add_minute_voice.mp3'],
      ];
      for (const [from, to] of mapping) {
        const src = path.join(sounds, from);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(raw, to));
      }
      return cfg;
    },
  ]);
}

function withServicePackage(config) {
  return withMainApplication(config, (cfg) => {
    const source =
      typeof cfg.modResults === 'string' ? cfg.modResults : cfg.modResults.contents;
    const patched = source.replace(
      /\/\/ Packages that cannot be autolinked yet can be added manually here, for example:\s*\n\s*\/\/ add\(MyReactNativePackage\(\)\)/,
      '// Packages that cannot be autolinked yet can be added manually here, for example:\n              add(TimerForegroundPackage())'
    );
    if (typeof cfg.modResults === 'string') {
      cfg.modResults = patched;
    } else {
      cfg.modResults.contents = patched;
    }
    return cfg;
  });
}

module.exports = function withTimerForegroundService(config) {
  config = withServiceManifest(config);
  config = withServiceSources(config);
  config = withServicePackage(config);
  return config;
};
