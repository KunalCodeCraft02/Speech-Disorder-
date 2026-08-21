package com.speechbiofeedback.app;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports whether an external microphone-capable headset -- Bluetooth
 * earbuds, a wired headset (3.5mm/USB-C jack with a mic), or a USB headset
 * -- is currently connected. Gates Part J's "must have headphones/earbuds
 * connected to use the app" requirement: the app is designed to capture
 * through the patient's own headset mic, not the phone's built-in mic, so
 * "connected" specifically means "an external audio INPUT device is
 * present," not just "any audio device at all" (e.g. plain wired
 * headphones with no mic wouldn't help -- getUserMedia would silently fall
 * back to the built-in mic anyway).
 *
 * Uses AudioManager.getDevices(GET_DEVICES_INPUTS) rather than
 * AudioManager.isBluetoothScoOn()/isWiredHeadsetOn() (those only reflect
 * whether this app has actively started that specific route, which it
 * never does -- getUserMedia's own audio backend negotiates routing
 * itself) or a BluetoothProfile.ServiceListener (needs the runtime
 * BLUETOOTH_CONNECT permission on Android 12+, an extra prompt this
 * feature doesn't otherwise need). Any of these device types being listed
 * at all means the OS considers that mic connected and available,
 * independent of whatever route is currently active.
 */
@CapacitorPlugin(name = "HeadsetAudio")
public class HeadsetAudioPlugin extends Plugin {
  private AudioDeviceCallback deviceCallback;

  private boolean isHeadsetInputType(int type) {
    switch (type) {
      case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
      case AudioDeviceInfo.TYPE_WIRED_HEADSET:
      case AudioDeviceInfo.TYPE_USB_HEADSET:
      case AudioDeviceInfo.TYPE_USB_DEVICE:
        return true;
      default:
        return false;
    }
  }

  private boolean isHeadsetInputConnected() {
    AudioManager audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    if (audioManager == null) return false;

    for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
      if (isHeadsetInputType(device.getType())) return true;
    }
    return false;
  }

  private JSObject statusPayload() {
    JSObject result = new JSObject();
    result.put("connected", isHeadsetInputConnected());
    return result;
  }

  @PluginMethod
  public void getStatus(PluginCall call) {
    call.resolve(statusPayload());
  }

  @Override
  protected void handleOnStart() {
    AudioManager audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    if (audioManager == null || deviceCallback != null) return;

    deviceCallback = new AudioDeviceCallback() {
      @Override
      public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
        notifyListeners("change", statusPayload());
      }

      @Override
      public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
        notifyListeners("change", statusPayload());
      }
    };
    audioManager.registerAudioDeviceCallback(deviceCallback, null);
  }

  @Override
  protected void handleOnDestroy() {
    AudioManager audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    if (audioManager != null && deviceCallback != null) {
      audioManager.unregisterAudioDeviceCallback(deviceCallback);
    }
    deviceCallback = null;
  }
}
