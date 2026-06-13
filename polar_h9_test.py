"""
Polar H9 Standalone BLE Test Script
====================================
This script verifies that we can:
1. Scan for and find the Polar H9 chest strap via BLE
2. Connect and subscribe to Heart Rate Measurement (0x2A37)
3. Parse the binary GATT payload for BPM + RR intervals
4. Compute a rolling 60-second RMSSD (our primary stress indicator)

Run this BEFORE integrating with the vision pipeline.
Make sure the Polar H9 strap is moistened and worn on your chest.

Usage:
    python polar_h9_test.py

Dependencies:
    pip install bleak numpy
"""

import asyncio
import struct
import time
import math
import sys
from collections import deque

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy is required. Install with: pip install numpy")
    sys.exit(1)

try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    print("ERROR: bleak is required. Install with: pip install bleak")
    sys.exit(1)


# --- GATT UUIDs ---
# Heart Rate Service
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
# Heart Rate Measurement Characteristic
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

# --- Configuration ---
DEVICE_NAME_PREFIX = "Polar H9"     # BLE advertised name prefix
SCAN_TIMEOUT = 15                   # Seconds to scan for the device
RUN_DURATION = 120                  # Seconds to collect data (2 minutes)
RMSSD_WINDOW_SECONDS = 60           # Window size for RMSSD computation

# --- Shared Data Storage ---
# Each entry is (timestamp_seconds, rr_interval_ms)
rr_buffer = deque(maxlen=300)       # ~300 beats ≈ 5 minutes at 60bpm
bpm_buffer = deque(maxlen=120)      # Store recent BPM readings
start_time = None


def parse_hr_measurement(data: bytearray):
    """
    Parse the Heart Rate Measurement GATT characteristic value.
    
    Byte layout (from Bluetooth SIG specification):
    ┌──────────────────────────────────────────────────────────┐
    │ Byte 0: Flags                                           │
    │   Bit 0: HR Value Format (0=UINT8, 1=UINT16)            │
    │   Bit 1: Sensor Contact Status bit                      │
    │   Bit 2: Sensor Contact Support bit                     │
    │   Bit 3: Energy Expended Status (0=not present)         │
    │   Bit 4: RR-Interval present (0=not present, 1=present) │
    ├──────────────────────────────────────────────────────────┤
    │ Byte 1 (or 1-2): Heart Rate Value                       │
    ├──────────────────────────────────────────────────────────┤
    │ Remaining bytes: RR-Interval values (UINT16, 1/1024 s)  │
    └──────────────────────────────────────────────────────────┘
    
    Returns:
        tuple: (heart_rate_bpm: int, rr_intervals_ms: list[float])
    """
    flags = data[0]
    
    # Bit 0: HR format
    hr_format_16bit = bool(flags & 0x01)
    # Bit 4: RR interval present
    rr_present = bool(flags & 0x10)
    
    offset = 1
    
    # Parse heart rate value
    if hr_format_16bit:
        heart_rate = struct.unpack_from("<H", data, offset)[0]
        offset += 2
    else:
        heart_rate = data[offset]
        offset += 1
    
    # Skip Energy Expended field if present (Bit 3)
    if flags & 0x08:
        offset += 2
    
    # Parse RR intervals
    rr_intervals_ms = []
    if rr_present:
        while offset + 1 < len(data):
            # RR interval is in units of 1/1024 seconds
            rr_raw = struct.unpack_from("<H", data, offset)[0]
            rr_ms = (rr_raw / 1024.0) * 1000.0  # Convert to milliseconds
            rr_intervals_ms.append(rr_ms)
            offset += 2
    
    return heart_rate, rr_intervals_ms


def compute_rmssd(rr_intervals_ms: list) -> float:
    """
    Compute RMSSD (Root Mean Square of Successive Differences).
    
    RMSSD is the primary short-term HRV metric reflecting parasympathetic
    (vagal) activity. Lower RMSSD indicates higher sympathetic activation
    (stress). Higher RMSSD indicates parasympathetic dominance (calm).
    
    Args:
        rr_intervals_ms: List of RR intervals in milliseconds
        
    Returns:
        RMSSD value in milliseconds, or -1.0 if insufficient data
    """
    if len(rr_intervals_ms) < 3:
        return -1.0
    
    rr = np.array(rr_intervals_ms)
    successive_diffs = np.diff(rr)
    
    if len(successive_diffs) == 0:
        return -1.0
    
    squared_diffs = successive_diffs ** 2
    mean_squared = np.mean(squared_diffs)
    rmssd = np.sqrt(mean_squared)
    
    return round(rmssd, 2)


def compute_sdnn(rr_intervals_ms: list) -> float:
    """
    Compute SDNN (Standard Deviation of NN intervals).
    Reflects total variability (both sympathetic and parasympathetic).
    """
    if len(rr_intervals_ms) < 3:
        return -1.0
    return round(float(np.std(rr_intervals_ms, ddof=1)), 2)


def get_windowed_rr(window_seconds: float) -> list:
    """Extract RR intervals from the buffer within the specified time window."""
    now = time.time()
    cutoff = now - window_seconds
    return [rr for ts, rr in rr_buffer if ts >= cutoff]


def notification_handler(sender, data: bytearray):
    """
    Callback invoked every time the Polar H9 sends a heart rate notification.
    Typically fires every ~1 second.
    """
    global start_time
    
    heart_rate, rr_intervals = parse_hr_measurement(data)
    now = time.time()
    
    if start_time is None:
        start_time = now
    
    elapsed = now - start_time
    
    # Store BPM
    bpm_buffer.append((now, heart_rate))
    
    # Store each RR interval with timestamp
    for rr_ms in rr_intervals:
        # Basic sanity check: physiologically valid RR interval
        # 300ms = 200bpm max, 2000ms = 30bpm min
        if 300.0 <= rr_ms <= 2000.0:
            rr_buffer.append((now, rr_ms))
    
    # Compute rolling RMSSD from 60-second window
    windowed_rr = get_windowed_rr(RMSSD_WINDOW_SECONDS)
    rmssd = compute_rmssd(windowed_rr)
    sdnn = compute_sdnn(windowed_rr)
    
    # Format RR intervals for display
    rr_str = ", ".join([f"{rr:.0f}" for rr in rr_intervals]) if rr_intervals else "none"
    
    # Build console output
    rmssd_str = f"{rmssd:.1f}ms" if rmssd >= 0 else "collecting..."
    sdnn_str = f"{sdnn:.1f}ms" if sdnn >= 0 else "..."
    
    print(
        f"[{elapsed:6.1f}s] "
        f"HR: {heart_rate:3d} bpm | "
        f"RR: [{rr_str:>20s}] ms | "
        f"Window: {len(windowed_rr):3d} beats | "
        f"RMSSD: {rmssd_str:>12s} | "
        f"SDNN: {sdnn_str:>10s}"
    )


async def scan_for_polar():
    """Scan for the Polar H9 device and return its address."""
    print(f"\n🔍 Scanning for '{DEVICE_NAME_PREFIX}' devices ({SCAN_TIMEOUT}s timeout)...")
    print("   Make sure the strap is moistened and worn on your chest.\n")
    
    devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT)
    
    polar_devices = []
    print(f"   Found {len(devices)} BLE devices total:")
    for d in devices:
        name = d.name or "Unknown"
        # Show all devices for debugging, highlight Polar ones
        if DEVICE_NAME_PREFIX.lower() in name.lower():
            polar_devices.append(d)
            print(f"   ✅ {name} [{d.address}] — POLAR DETECTED")
        # Uncomment the line below to see ALL nearby BLE devices (for debugging)
        # else:
        #     print(f"      {name} [{d.address}]")
    
    if not polar_devices:
        print(f"\n   ❌ No '{DEVICE_NAME_PREFIX}' device found.")
        print("   Troubleshooting:")
        print("   1. Moisten the electrode pads on the strap")
        print("   2. Put the strap on — the H9 only advertises when it detects skin contact")
        print("   3. Make sure no other app (Polar Beat, etc.) is connected to it")
        print("   4. Try restarting Bluetooth on your PC")
        return None
    
    # Use the first Polar device found
    device = polar_devices[0]
    print(f"\n   Selected: {device.name} [{device.address}]")
    return device


async def enumerate_services(client: BleakClient):
    """Print all GATT services and characteristics (for debugging)."""
    print("\n📋 GATT Services & Characteristics:")
    print("=" * 60)
    for service in client.services:
        print(f"\n   Service: {service.uuid}")
        print(f"   Description: {service.description}")
        for char in service.characteristics:
            props = ", ".join(char.properties)
            print(f"     └── {char.uuid} | {char.description} | [{props}]")
    print("=" * 60)


async def main():
    """Main entry point: scan, connect, subscribe, and collect data."""
    print("=" * 70)
    print("  POLAR H9 — Standalone BLE Verification Script")
    print("  Stress Indicator: RMSSD (Heart Rate Variability)")
    print("=" * 70)
    
    # Step 1: Scan for the device
    device = await scan_for_polar()
    if device is None:
        return
    
    # Step 2: Connect to the device
    print(f"\n🔗 Connecting to {device.name}...")
    
    disconnect_event = asyncio.Event()

    def on_disconnect(client):
        print("\n\n⚠️  Polar H9 disconnected mid-session!")
        print("   This can happen if the strap loses skin contact.")
        disconnect_event.set()

    async with BleakClient(device.address, timeout=20.0,
                           disconnected_callback=on_disconnect) as client:
        if not client.is_connected:
            print("   ❌ Failed to connect.")
            return
        
        print(f"   ✅ Connected to {device.name}!")
        
        # Step 3: Enumerate services (for debugging, shows what's available)
        await enumerate_services(client)
        
        # Step 4: Subscribe to Heart Rate Measurement notifications
        print(f"\n📡 Subscribing to Heart Rate Measurement (UUID: {HR_MEASUREMENT_UUID})...")
        
        try:
            await client.start_notify(HR_MEASUREMENT_UUID, notification_handler)
            print("   ✅ Subscription active! Receiving data...\n")
            print("-" * 100)
            print(f"{'Time':>8s}   {'HR':>6s}   {'RR Intervals':>22s}   {'Window':>8s}   {'RMSSD':>14s}   {'SDNN':>12s}")
            print("-" * 100)
        except Exception as e:
            print(f"   ❌ Failed to subscribe: {e}")
            return
        
        # Step 5: Collect data — wait for timeout or disconnect
        try:
            await asyncio.wait_for(disconnect_event.wait(), timeout=RUN_DURATION)
        except asyncio.TimeoutError:
            pass  # Normal completion — duration elapsed
        
        # Step 6: Stop notifications (gracefully handle if already disconnected)
        try:
            if client.is_connected:
                await client.stop_notify(HR_MEASUREMENT_UUID)
        except Exception:
            pass  # Already disconnected, nothing to clean up
    
    # Final summary
    print("\n" + "=" * 70)
    print("  SESSION SUMMARY")
    print("=" * 70)
    
    if len(bpm_buffer) > 0:
        bpms = [bpm for _, bpm in bpm_buffer]
        print(f"  Total notifications received: {len(bpm_buffer)}")
        print(f"  Total RR intervals recorded:  {len(rr_buffer)}")
        print(f"  HR range: {min(bpms)} – {max(bpms)} bpm")
        print(f"  Mean HR:  {sum(bpms)/len(bpms):.1f} bpm")
        
        all_rr = [rr for _, rr in rr_buffer]
        if len(all_rr) >= 3:
            final_rmssd = compute_rmssd(all_rr)
            final_sdnn = compute_sdnn(all_rr)
            print(f"\n  Full-session RMSSD: {final_rmssd:.2f} ms")
            print(f"  Full-session SDNN:  {final_sdnn:.2f} ms")
            print(f"  Mean RR interval:   {np.mean(all_rr):.1f} ms")
            
            # Interpretation
            print(f"\n  📊 Interpretation:")
            if final_rmssd > 40:
                print(f"     RMSSD {final_rmssd:.0f}ms → Good parasympathetic tone (relaxed state)")
            elif final_rmssd > 20:
                print(f"     RMSSD {final_rmssd:.0f}ms → Moderate HRV (neutral/mildly elevated stress)")
            else:
                print(f"     RMSSD {final_rmssd:.0f}ms → Low HRV (elevated sympathetic activity / stress)")
        else:
            print("\n  ⚠️  Insufficient RR data for HRV analysis.")
            print("     The Polar H9 may not be sending RR intervals.")
            print("     Ensure the strap has good skin contact.")
    else:
        print("  ⚠️  No data received. Check the connection and strap placement.")
    
    print("\n" + "=" * 70)
    print("  ✅ Hardware verification complete. If data looks valid,")
    print("     proceed to Step 2 (integration with vision pipeline).")
    print("=" * 70)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nExiting...")
